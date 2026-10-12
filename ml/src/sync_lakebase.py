# Databricks notebook source
# MAGIC %md
# MAGIC # Eastwind Gourmet — Lakebase sync
# MAGIC
# MAGIC The workspace cannot create the Unity Catalog catalog that managed synced tables need, so this task moves data itself over psycopg, using an OAuth database credential for the job's identity.
# MAGIC
# MAGIC - `direction = load_recommendations`: `gold.replenishment_recommendations_current` → Lakebase `serving.recommendations`. One transaction upserts every current row and deletes rows that are no longer current. The table is small (one row per store-SKU), so a full idempotent upsert is simpler and safer than replaying the change feed. Optionally grants the app's service principal read access.
# MAGIC - `direction = ingest_decisions`: the app-owned `replenishment.order_decisions` / `replenishment.decision_events` → `gold.order_decisions_history` / `gold.order_decision_events`, so manager decisions are governed and queryable in Unity Catalog.

# COMMAND ----------

dbutils.widgets.text("catalog", "darren_fe_bar_catalog")
dbutils.widgets.text("lakebase_endpoint", "projects/eastwind-replenishment/branches/production/endpoints/primary")
dbutils.widgets.text("database", "databricks_postgres")
dbutils.widgets.dropdown("direction", "load_recommendations", ["load_recommendations", "ingest_decisions"])
dbutils.widgets.text("app_sp_client_id", "")

import json

import psycopg
from databricks.sdk import WorkspaceClient
from pyspark.sql import types as T

CATALOG = dbutils.widgets.get("catalog")
ENDPOINT = dbutils.widgets.get("lakebase_endpoint")
DATABASE = dbutils.widgets.get("database")
DIRECTION = dbutils.widgets.get("direction")
APP_SP = dbutils.widgets.get("app_sp_client_id").strip()

w = WorkspaceClient()
conninfo = dict(
    host=w.postgres.get_endpoint(name=ENDPOINT).status.hosts.host,
    dbname=DATABASE,
    user=w.current_user.me().user_name,
    password=w.postgres.generate_database_credential(endpoint=ENDPOINT).token,
    sslmode="require",
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Delta → Lakebase: current recommendations

# COMMAND ----------

PG_TYPES = {
    T.StringType: "text", T.DateType: "date", T.TimestampType: "timestamptz", T.BooleanType: "boolean",
    T.IntegerType: "integer", T.LongType: "bigint", T.DoubleType: "double precision", T.FloatType: "double precision",
    T.DecimalType: "numeric",
}


def load_recommendations():
    df = spark.table(f"{CATALOG}.gold.replenishment_recommendations_current")
    cols = [(f.name, PG_TYPES[type(f.dataType)]) for f in df.schema.fields]
    names = [c for c, _ in cols]
    rows = [tuple(r[c] for c in names) for r in df.collect()]
    col_ddl = ",\n  ".join(f"{c} {t}" + (" PRIMARY KEY" if c == "recommendation_id" else "") for c, t in cols)
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in names if c != "recommendation_id")

    with psycopg.connect(**conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE SCHEMA IF NOT EXISTS serving")
            cur.execute(f"CREATE TABLE IF NOT EXISTS serving.recommendations (\n  {col_ddl},\n  loaded_at timestamptz NOT NULL DEFAULT now()\n)")
            cur.execute("CREATE TEMP TABLE staged (LIKE serving.recommendations INCLUDING DEFAULTS) ON COMMIT DROP")
            with cur.copy(f"COPY staged ({', '.join(names)}) FROM STDIN") as copy:
                for r in rows:
                    copy.write_row(r)
            cur.execute(f"""
                INSERT INTO serving.recommendations ({', '.join(names)})
                SELECT {', '.join(names)} FROM staged
                ON CONFLICT (recommendation_id) DO UPDATE SET {updates}, loaded_at = now()
            """)
            upserted = cur.rowcount
            cur.execute("DELETE FROM serving.recommendations r WHERE NOT EXISTS (SELECT 1 FROM staged s WHERE s.recommendation_id = r.recommendation_id)")
            deleted = cur.rowcount
            cur.execute("CREATE INDEX IF NOT EXISTS recommendations_region_idx ON serving.recommendations (region, channel_type)")
            if APP_SP:
                cur.execute(f'GRANT USAGE ON SCHEMA serving TO "{APP_SP}"')
                cur.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA serving TO "{APP_SP}"')
                cur.execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA serving GRANT SELECT ON TABLES TO "{APP_SP}"')
            cur.execute("SELECT count(*), sum(recommended_units), max(as_of_date), max(loaded_at) FROM serving.recommendations")
            n, units, as_of, loaded_at = cur.fetchone()
    return {"delta_rows": len(rows), "upserted": upserted, "deleted": deleted, "lakebase_rows": n,
            "lakebase_units": int(units or 0), "as_of_date": str(as_of), "loaded_at": str(loaded_at),
            "granted_to_app_sp": bool(APP_SP)}

# COMMAND ----------

# MAGIC %md
# MAGIC ## Lakebase → Delta: manager decisions

# COMMAND ----------

DECISION_SCHEMA = T.StructType([
    T.StructField("decision_id", T.StringType()), T.StructField("recommendation_id", T.StringType()),
    T.StructField("as_of_date", T.DateType()), T.StructField("location_id", T.StringType()),
    T.StructField("sku_id", T.StringType()), T.StructField("decision_status", T.StringType()),
    T.StructField("recommended_units", T.IntegerType()), T.StructField("final_order_units", T.IntegerType()),
    T.StructField("reason", T.StringType()), T.StructField("decided_by", T.StringType()),
    T.StructField("decided_at", T.TimestampType()), T.StructField("updated_at", T.TimestampType()),
    T.StructField("version", T.IntegerType()),
])
EVENT_SCHEMA = T.StructType([
    T.StructField("event_id", T.StringType()), T.StructField("decision_id", T.StringType()),
    T.StructField("recommendation_id", T.StringType()), T.StructField("previous_status", T.StringType()),
    T.StructField("new_status", T.StringType()), T.StructField("previous_units", T.IntegerType()),
    T.StructField("new_units", T.IntegerType()), T.StructField("reason", T.StringType()),
    T.StructField("changed_by", T.StringType()), T.StructField("changed_at", T.TimestampType()),
])


def fetch(cur, sql, schema):
    cur.execute(sql)
    return [tuple(str(v) if f.dataType == T.StringType() and v is not None else v for v, f in zip(r, schema.fields))
            for r in cur.fetchall()]


def ingest_decisions():
    with psycopg.connect(**conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass('replenishment.order_decisions'), to_regclass('replenishment.decision_events')")
            exists = cur.fetchone()
            decisions = fetch(cur, f"SELECT {', '.join(f.name for f in DECISION_SCHEMA.fields)} FROM replenishment.order_decisions", DECISION_SCHEMA) if exists[0] else []
            events = fetch(cur, f"SELECT {', '.join(f.name for f in EVENT_SCHEMA.fields)} FROM replenishment.decision_events", EVENT_SCHEMA) if exists[1] else []
    (spark.createDataFrame(decisions, DECISION_SCHEMA).write.mode("overwrite").option("overwriteSchema", "true")
     .saveAsTable(f"{CATALOG}.gold.order_decisions_history"))
    (spark.createDataFrame(events, EVENT_SCHEMA).write.mode("overwrite").option("overwriteSchema", "true")
     .saveAsTable(f"{CATALOG}.gold.order_decision_events"))
    spark.sql(f"COMMENT ON TABLE {CATALOG}.gold.order_decisions_history IS 'Current manager decision per recommendation, copied from Lakebase replenishment.order_decisions.'")
    spark.sql(f"COMMENT ON TABLE {CATALOG}.gold.order_decision_events IS 'Append-only audit trail of manager decisions, copied from Lakebase replenishment.decision_events.'")
    by_status = {}
    for d in decisions:
        by_status[d[5]] = by_status.get(d[5], 0) + 1
    return {"decisions": len(decisions), "events": len(events), "by_status": by_status}

# COMMAND ----------

result = load_recommendations() if DIRECTION == "load_recommendations" else ingest_decisions()
dbutils.notebook.exit(json.dumps({"direction": DIRECTION, **result}))
