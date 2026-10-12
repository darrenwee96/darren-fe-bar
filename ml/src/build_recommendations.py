# Databricks notebook source
# MAGIC %md
# MAGIC # Eastwind Gourmet — replenishment recommendations
# MAGIC
# MAGIC Turns the latest `@champion` forecast run into one order recommendation per store-SKU.
# MAGIC
# MAGIC Weekly approximation of the plan's formula, with lead time L weeks and a 7-day review cycle:
# MAGIC
# MAGIC - **Cover** = weeks 1..L+1. `raw_need = Σ expected + safety − on_hand − inbound`, where `safety = √Σ(p90 − expected)²`. Summing weekly p90s would overstate the p90 of the total.
# MAGIC - **Shelf-life cap** (only when expiry falls inside the 6-week horizon): the order arrives at week L+1 and must sell by week L + shelf-life weeks. `sellable = Σ expected in that window − stock projected to remain at receipt`.
# MAGIC - Orders round up to whole cases. The final order is `min(need, sellable)`.
# MAGIC
# MAGIC Writes `gold.replenishment_recommendations_current` with a MERGE (Change Data Feed on) so the Lakebase load can copy only changes.

# COMMAND ----------

dbutils.widgets.text("catalog", "darren_fe_bar_catalog")
CATALOG = dbutils.widgets.get("catalog")
TARGET = f"{CATALOG}.gold.replenishment_recommendations_current"
spark.sql(f"USE CATALOG {CATALOG}")

# COMMAND ----------

spark.sql("""
CREATE OR REPLACE TEMPORARY VIEW recommendations_staged AS
WITH run AS (
  SELECT forecast_run_id, as_of_date, model_version
  FROM gold.demand_forecasts_current
  ORDER BY generated_at DESC
  LIMIT 1
),
forecast AS (
  SELECT f.* FROM gold.demand_forecasts_current f JOIN run USING (forecast_run_id)
),
product AS (
  SELECT *, CAST(lead_time_days / 7 AS INT) AS lead_weeks, CAST(floor(shelf_life_days / 7) AS INT) AS shelf_weeks
  FROM silver.dim_product
),
position AS (
  -- Stock at the Sunday close before the as-of Monday.
  SELECT i.location_id, i.sku_id, i.on_hand_units, i.inbound_units
  FROM silver.fact_inventory_daily i CROSS JOIN run
  WHERE i.snapshot_date = date_sub(run.as_of_date, 1)
),
recent AS (
  SELECT g.location_id, g.sku_id, avg(g.units_sold) AS recent_weekly_units
  FROM gold.weekly_demand_features g CROSS JOIN run
  WHERE g.week_start >= date_sub(run.as_of_date, 28)
  GROUP BY ALL
),
next_event AS (
  SELECT c.next_event_name, c.weeks_to_next_event
  FROM silver.dim_calendar c JOIN run ON c.date = run.as_of_date
),
agg AS (
  SELECT
    f.location_id,
    f.sku_id,
    sum(CASE WHEN f.horizon <= p.lead_weeks + 1 THEN f.forecast_units ELSE 0 END) AS demand_cover_units,
    sqrt(sum(CASE WHEN f.horizon <= p.lead_weeks + 1 THEN pow(f.forecast_p90 - f.forecast_units, 2) ELSE 0 END)) AS safety_units,
    sum(CASE WHEN f.horizon <= p.lead_weeks THEN f.forecast_units ELSE 0 END) AS demand_before_receipt,
    sum(CASE WHEN f.horizon > p.lead_weeks AND f.horizon <= p.lead_weeks + p.shelf_weeks THEN f.forecast_units ELSE 0 END) AS demand_in_shelf_window,
    sum(CASE WHEN f.horizon <= greatest(p.shelf_weeks, 1) THEN f.forecast_units ELSE 0 END) AS demand_before_current_expiry,
    sum(f.forecast_units) AS demand_6w_units,
    max_by(f.top_driver, abs(f.top_driver_contribution)) AS model_top_driver,
    sum(CASE WHEN f.top_driver = 'Holiday' THEN f.top_driver_contribution ELSE 0 END) AS holiday_driver_units,
    sum(CASE WHEN f.top_driver = 'Recent trend' THEN f.top_driver_contribution ELSE 0 END) AS recent_driver_units,
    sum(CASE WHEN f.top_driver = 'Last year' THEN f.top_driver_contribution ELSE 0 END) AS last_year_driver_units,
    sum(CASE WHEN f.top_driver = 'Store-product baseline' THEN f.top_driver_contribution ELSE 0 END) AS baseline_driver_units
  FROM forecast f
  JOIN product p USING (sku_id)
  GROUP BY ALL
),
calc AS (
  SELECT
    a.*,
    p.sku_name, p.category, p.peak_gift_flag, p.shelf_life_days, p.case_pack_units, p.lead_time_days,
    p.lead_weeks, p.shelf_weeks, p.unit_cost, p.list_price,
    l.location_name, l.channel_type, l.region,
    coalesce(pos.on_hand_units, 0) AS on_hand_units,
    coalesce(pos.inbound_units, 0) AS inbound_units,
    coalesce(pos.on_hand_units, 0) + coalesce(pos.inbound_units, 0) AS stock_position,
    r.recent_weekly_units,
    -- The cap only applies when expiry falls inside the forecast horizon.
    p.lead_weeks + p.shelf_weeks <= 6 AS shelf_cap_applies
  FROM agg a
  JOIN product p USING (sku_id)
  JOIN silver.dim_location l USING (location_id)
  LEFT JOIN position pos USING (location_id, sku_id)
  LEFT JOIN recent r USING (location_id, sku_id)
),
sized AS (
  SELECT
    *,
    demand_cover_units + safety_units - stock_position AS raw_need_units,
    greatest(0, stock_position - demand_before_receipt) AS projected_on_hand_at_receipt,
    demand_in_shelf_window - greatest(0, stock_position - demand_before_receipt) AS sellable_before_expiry_units,
    CAST(ceil(greatest(0, demand_cover_units + safety_units - stock_position) / case_pack_units) * case_pack_units AS INT) AS uncapped_units,
    CAST(ceil(greatest(0, demand_in_shelf_window - greatest(0, stock_position - demand_before_receipt)) / case_pack_units) * case_pack_units AS INT) AS shelf_cap_units
  FROM calc
)
SELECT
  substr(sha2(concat_ws('|', run.as_of_date, s.location_id, s.sku_id), 256), 1, 16) AS recommendation_id,
  run.as_of_date,
  run.forecast_run_id,
  run.model_version,
  s.location_id, s.location_name, s.channel_type, s.region,
  s.sku_id, s.sku_name, s.category, s.peak_gift_flag,
  s.shelf_life_days, s.lead_time_days, s.case_pack_units,
  CAST(s.unit_cost AS DOUBLE) AS unit_cost,
  CAST(s.list_price AS DOUBLE) AS list_price,
  s.on_hand_units, s.inbound_units,
  round(s.recent_weekly_units, 1) AS recent_weekly_units,
  round(s.demand_cover_units, 1) AS demand_cover_units,
  round(s.safety_units, 1) AS safety_units,
  round(s.demand_6w_units, 1) AS demand_6w_units,
  round(s.raw_need_units, 1) AS raw_need_units,
  round(s.sellable_before_expiry_units, 1) AS sellable_before_expiry_units,
  CASE WHEN s.shelf_cap_applies AND s.shelf_cap_units < s.uncapped_units THEN s.shelf_cap_units ELSE s.uncapped_units END AS recommended_units,
  CASE WHEN s.shelf_cap_applies AND s.shelf_cap_units < s.uncapped_units THEN 'SHELF_LIFE' ELSE 'NONE' END AS cap_applied,
  CASE WHEN s.stock_position < s.demand_cover_units THEN 'HIGH'
       WHEN s.stock_position < s.demand_cover_units + s.safety_units THEN 'MEDIUM'
       ELSE 'LOW' END AS stockout_risk,
  CASE WHEN s.shelf_weeks < 6 AND s.stock_position > s.demand_before_current_expiry THEN 'HIGH'
       WHEN s.stock_position > s.demand_6w_units THEN 'MEDIUM'
       ELSE 'LOW' END AS overstock_risk,
  round(greatest(0, s.demand_cover_units - s.stock_position) * s.list_price, 2) AS est_lost_sales_if_no_order,
  round(CASE WHEN s.shelf_weeks < 6 THEN greatest(0, s.stock_position - s.demand_before_current_expiry) * s.unit_cost ELSE 0 END, 2) AS est_expiry_value,
  s.model_top_driver AS top_driver,
  concat_ws(' · ',
    CASE WHEN abs(s.holiday_driver_units) >= greatest(abs(s.recent_driver_units), abs(s.last_year_driver_units), abs(s.baseline_driver_units))
         THEN concat(CASE WHEN s.holiday_driver_units >= 0 THEN '+' ELSE '' END, format_number(s.holiday_driver_units, 0), ' units from holiday timing') END,
    CASE WHEN abs(s.recent_driver_units) >= greatest(abs(s.last_year_driver_units), abs(s.baseline_driver_units))
         THEN concat(CASE WHEN s.recent_driver_units >= 0 THEN '+' ELSE '' END, format_number(s.recent_driver_units, 0), ' units from recent trend') END,
    CASE WHEN abs(s.last_year_driver_units) >= greatest(abs(s.holiday_driver_units), abs(s.baseline_driver_units))
         THEN concat(CASE WHEN s.last_year_driver_units >= 0 THEN '+' ELSE '' END, format_number(s.last_year_driver_units, 0), ' units from last year') END,
    concat(format_number(s.baseline_driver_units, 0), ' units from store-product baseline'),
    CASE WHEN ne.weeks_to_next_event <= 6 AND s.recent_weekly_units > 0
              AND s.demand_cover_units / (s.lead_weeks + 1) > 1.2 * s.recent_weekly_units
         THEN concat(ne.next_event_name, ' in ', ne.weeks_to_next_event, CASE WHEN ne.weeks_to_next_event = 1 THEN ' week' ELSE ' weeks' END) END,
    CASE WHEN s.recent_weekly_units > 0 AND (s.demand_cover_units / (s.lead_weeks + 1)) >= 2 * s.recent_weekly_units
         THEN concat('Forecast ', format_number((s.demand_cover_units / (s.lead_weeks + 1)) / s.recent_weekly_units, 1), 'x recent weekly sales')
         WHEN s.recent_weekly_units > 0
         THEN concat('Forecast ', format_number((s.demand_cover_units / (s.lead_weeks + 1)) / s.recent_weekly_units * 100 - 100, 0), '% vs last 4 weeks') END,
    CASE WHEN s.stock_position < s.demand_cover_units
         THEN concat('Stock covers ', format_number(s.stock_position / greatest(s.demand_cover_units / (s.lead_weeks + 1), 0.1), 1), ' of ', s.lead_weeks + 1, ' weeks needed') END,
    CASE WHEN s.shelf_cap_applies AND s.shelf_cap_units < s.uncapped_units
         THEN concat('Capped by ', s.shelf_life_days, '-day shelf life') END
  ) AS explanation_text,
  current_timestamp() AS refreshed_at
FROM sized s
CROSS JOIN run
LEFT JOIN next_event ne ON true
""")

# COMMAND ----------

spark.sql(f"""
CREATE TABLE IF NOT EXISTS {TARGET}
TBLPROPERTIES (delta.enableChangeDataFeed = true)
COMMENT 'One current order recommendation per store-SKU from the latest @champion forecast; MERGE-updated with Change Data Feed for the Lakebase load.'
AS SELECT * FROM recommendations_staged WHERE false
""")
merge = spark.sql(f"""
MERGE INTO {TARGET} t
USING recommendations_staged s
ON t.recommendation_id = s.recommendation_id
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *
WHEN NOT MATCHED BY SOURCE THEN DELETE
""").collect()[0].asDict()

summary = spark.sql(f"""
SELECT count(*) AS rows, sum(recommended_units) AS units, count_if(recommended_units > 0) AS lines_to_order,
       count_if(cap_applied = 'SHELF_LIFE') AS shelf_capped, count_if(stockout_risk = 'HIGH') AS high_stockout_risk,
       count_if(overstock_risk = 'HIGH') AS high_overstock_risk, round(sum(recommended_units * unit_cost), 0) AS order_value_at_cost
FROM {TARGET}
""").collect()[0].asDict()

import json
dbutils.notebook.exit(json.dumps({"merge": {k: int(v) for k, v in merge.items()}, "summary": {k: (float(v) if v is not None else None) for k, v in summary.items()}}))
