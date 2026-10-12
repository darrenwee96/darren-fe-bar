# Databricks notebook source
# MAGIC %md
# MAGIC # Eastwind Gourmet — weekly demand forecast
# MAGIC
# MAGIC One global LightGBM model forecasts store × SKU demand 1–6 weeks ahead from `gold.weekly_demand_features`.
# MAGIC
# MAGIC - **Direct multi-horizon:** each training row is (origin week, horizon). Demand lags are as of the origin; event features are for the target week.
# MAGIC - **Two models:** Tweedie for the expected forecast, quantile (α = 0.9) for the p90 used as safety stock.
# MAGIC - **Baselines:** seasonal-naive (same calendar week last year) and event-aligned naive (same week relative to the same holiday last year).
# MAGIC - **Censoring:** weeks with ≥ 2 out-of-stock days understate demand, so they are excluded from training targets and accuracy scoring.
# MAGIC - **Backtest:** rolling origins over Mid-Autumn 2025 and Lunar New Year 2026; models train only on target weeks before each fold.
# MAGIC - **MLflow:** every fold and the final model are runs in one experiment; the final model is registered to Unity Catalog and aliased `@champion`, then scores six weeks from the as-of date into `gold.demand_forecasts`.

# COMMAND ----------

dbutils.widgets.text("catalog", "darren_fe_bar_catalog")
dbutils.widgets.text("experiment", "/Users/darren.wee@databricks.com/eastwind-gourmet/demand_forecasting")
dbutils.widgets.text("as_of", "2026-08-31")
dbutils.widgets.text("mode", "train_score")

import json
import hashlib
import warnings

import lightgbm as lgb
import mlflow
import numpy as np
import pandas as pd
from mlflow.models import infer_signature
from mlflow.tracking import MlflowClient
from pyspark.sql import functions as F

warnings.filterwarnings("ignore", category=RuntimeWarning)  # nanmean over all-NaN windows

CATALOG = dbutils.widgets.get("catalog")
EXPERIMENT = dbutils.widgets.get("experiment")
AS_OF = pd.Timestamp(dbutils.widgets.get("as_of"))
MODE = dbutils.widgets.get("mode")
MODEL_NAME = f"{CATALOG}.ml.eastwind_demand"
HORIZON = 6
CENSORED_OOS_DAYS = 2
PROMOTE_TOLERANCE = 0.002
# Backtest folds: (name, first origin, last origin). Each fold trains on target weeks before its first origin.
FOLDS = [
    ("MA2025", "2025-08-04", "2025-10-20"),  # Mid-Autumn 2025-10-06
    ("LNY2026", "2026-01-05", "2026-03-02"),  # Lunar New Year 2026-02-17
]
SEED = 42

mlflow.set_registry_uri("databricks-uc")
experiment_id = mlflow.set_experiment(EXPERIMENT).experiment_id

# COMMAND ----------

# MAGIC %md
# MAGIC ## Load history and calendar

# COMMAND ----------

hist = (
    spark.table(f"{CATALOG}.gold.weekly_demand_features")
    .select("location_id", "sku_id", "week_start", "units_sold", "demand_units_uncensored", "oos_days", "in_stock_days",
            "channel_type", "region", "capacity_tier", "category", "gift_flag", "peak_gift_flag",
            "shelf_life_days", "lead_time_days", "case_pack_units", "unit_cost", "list_price")
    .toPandas()
)
hist["week_start"] = pd.to_datetime(hist["week_start"])
for money_col in ["list_price", "unit_cost"]:
    hist[money_col] = hist[money_col].astype(float)
cal = (
    spark.table(f"{CATALOG}.silver.dim_calendar")
    .where("day_of_week = 2")  # Mondays
    .select(F.col("date").alias("week_start"), "next_event_type", "next_event_seq",
            "weeks_to_next_event", "days_to_next_event", "days_from_week_start_to_next_event",
            "weeks_to_next_event_week", "event_window_days_in_week", "event_peak_days_in_week", "in_event_window")
    .toPandas()
)
cal["week_start"] = pd.to_datetime(cal["week_start"])

BASE = hist["week_start"].min()
hist["k"] = ((hist["week_start"] - BASE).dt.days // 7).astype(int)
K_HIST = int(hist["k"].max()) + 1  # weeks of history; week K_HIST is the first unobserved week
assert BASE + pd.Timedelta(weeks=K_HIST) == AS_OF, f"as_of {AS_OF.date()} must be the week after the last observed week"

series = (hist.sort_values("week_start").groupby(["location_id", "sku_id"], as_index=False).last()
          .drop(columns=["week_start", "units_sold", "oos_days", "k"]))
series["s"] = np.arange(len(series))
hist = hist.merge(series[["location_id", "sku_id", "s"]], on=["location_id", "sku_id"])
S = len(series)

# Dense matrices: units and out-of-stock days by series x week; NaN where the SKU is not stocked.
U = np.full((S, K_HIST), np.nan)
OOS = np.zeros((S, K_HIST))
U[hist["s"], hist["k"]] = hist["demand_units_uncensored"].fillna(hist["units_sold"])
OOS[hist["s"], hist["k"]] = hist["oos_days"]
INSTOCK = np.zeros((S, K_HIST))
INSTOCK[hist["s"], hist["k"]] = hist["in_stock_days"].fillna(7)

cal["k"] = ((cal["week_start"] - BASE).dt.days // 7).astype(int)
cal_by_k = cal.set_index("k")
# (event_type, event_seq, weeks_to_event) -> week index, for event-aligned "same week last year".
event_week = {(r.next_event_type, int(r.next_event_seq), int(r.weeks_to_next_event_week)): int(r.k)
              for r in cal.dropna(subset=["next_event_type"]).itertuples()}
print(f"series={S} history_weeks={K_HIST} base={BASE.date()} as_of={AS_OF.date()}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Build the (origin, horizon) design matrix

# COMMAND ----------

CAT_FEATURES = ["location_id", "sku_id", "channel_type", "region", "capacity_tier", "category", "t_next_event_type"]
NUM_FEATURES = [
    "horizon", "gift_flag", "peak_gift_flag", "shelf_life_days", "list_price",
    "lag_1", "lag_2", "lag_4", "roll_mean_4", "roll_mean_8", "oos_days_prev_4", "ly_origin_mean_4",
    "in_stock_days_prev_4", "t_lag_52", "t_same_event_ly", "t_weeks_to_next_event", "t_weeks_to_next_event_week",
    "t_days_from_week_start_to_next_event", "t_event_window_days_in_week", "t_event_peak_days_in_week",
    "t_in_event_window", "t_week_of_year",
]
FEATURES = CAT_FEATURES + NUM_FEATURES
FEATURE_SCHEMA_HASH = hashlib.sha256("|".join(FEATURES).encode()).hexdigest()
CATEGORIES = {c: sorted(series[c].unique().tolist()) for c in CAT_FEATURES if c != "t_next_event_type"}
CATEGORIES["t_next_event_type"] = sorted(cal["next_event_type"].dropna().unique().tolist())


def driver_group(feature):
    if feature in {"t_same_event_ly", "t_weeks_to_next_event", "t_weeks_to_next_event_week",
                   "t_days_from_week_start_to_next_event", "t_event_window_days_in_week",
                   "t_event_peak_days_in_week", "t_in_event_window", "t_next_event_type"}:
        return "Holiday"
    if feature in {"lag_1", "lag_2", "lag_4", "roll_mean_4", "roll_mean_8", "oos_days_prev_4", "in_stock_days_prev_4"}:
        return "Recent trend"
    if feature in {"t_lag_52", "ly_origin_mean_4"}:
        return "Last year"
    return "Store-product baseline"


def week_col(m, k):
    return m[:, k] if 0 <= k < m.shape[1] else np.full(S, np.nan)


def window_mean(lo, hi):
    lo, hi = max(lo, 0), min(hi, K_HIST)
    return np.nanmean(U[:, lo:hi], axis=1) if hi > lo else np.full(S, np.nan)


def design(origins):
    """One row per series x origin x horizon. Origin o = first forecast week; data known through o-1."""
    static = series[["location_id", "sku_id", "channel_type", "region", "capacity_tier", "category",
                     "gift_flag", "peak_gift_flag", "shelf_life_days", "lead_time_days", "case_pack_units",
                     "unit_cost", "list_price"]]
    parts = []
    for o in origins:
        origin = {
            "lag_1": week_col(U, o - 1), "lag_2": week_col(U, o - 2), "lag_4": week_col(U, o - 4),
            "roll_mean_4": window_mean(o - 4, o), "roll_mean_8": window_mean(o - 8, o),
            "oos_days_prev_4": OOS[:, max(0, o - 4):min(o, K_HIST)].sum(axis=1),
            "in_stock_days_prev_4": INSTOCK[:, max(0, o - 4):min(o, K_HIST)].sum(axis=1),
            "ly_origin_mean_4": window_mean(o - 56, o - 52),
        }
        for h in range(1, HORIZON + 1):
            t = o + h - 1
            c = cal_by_k.loc[t]
            ly_k = event_week.get((c.next_event_type, int(c.next_event_seq) - 1, int(c.weeks_to_next_event_week)), -1)
            df = static.copy()
            df["origin_week"] = BASE + pd.Timedelta(weeks=o)
            df["target_week"] = BASE + pd.Timedelta(weeks=t)
            df["horizon"] = h
            for name, v in origin.items():
                df[name] = v
            df["t_lag_52"] = week_col(U, t - 52)
            df["t_same_event_ly"] = week_col(U, ly_k)
            df["t_next_event_type"] = c.next_event_type
            df["t_weeks_to_next_event"] = int(c.weeks_to_next_event)
            df["t_weeks_to_next_event_week"] = int(c.weeks_to_next_event_week)
            df["t_days_to_next_event"] = int(c.days_to_next_event)
            df["t_days_from_week_start_to_next_event"] = int(c.days_from_week_start_to_next_event)
            df["t_event_window_days_in_week"] = int(c.event_window_days_in_week)
            df["t_event_peak_days_in_week"] = int(c.event_peak_days_in_week)
            df["t_in_event_window"] = int(bool(c.in_event_window))
            df["t_week_of_year"] = int((BASE + pd.Timedelta(weeks=t)).isocalendar().week)
            df["actual"] = week_col(U, t)
            df["censored"] = week_col(OOS, t) >= CENSORED_OOS_DAYS
            parts.append(df)
    out = pd.concat(parts, ignore_index=True)
    for col_name, cats in CATEGORIES.items():
        out[col_name] = pd.Categorical(out[col_name], categories=cats)
    out["gift_flag"] = out["gift_flag"].astype(int)
    out["peak_gift_flag"] = out["peak_gift_flag"].astype(int)
    out["list_price"] = out["list_price"].astype(float)
    # Baselines (fall back to the recent average when last year is unavailable).
    out["seasonal_naive"] = out["t_lag_52"].fillna(out["roll_mean_4"]).fillna(0.0)
    out["event_naive"] = out["t_same_event_ly"].fillna(out["seasonal_naive"])
    return out


def trainable(df):
    return df[df["actual"].notna()]


def observed_scored(df):
    return df[df["actual"].notna() & ~df["censored"]]


all_origins = list(range(8, K_HIST))  # need 8 weeks of lags
history = design(all_origins)
print(f"design rows={len(history):,}  trainable={len(trainable(history)):,}")

if MODE == "score_only":
    with mlflow.start_run(run_name="score_champion_only") as score_run:
        future = design([K_HIST])
        client = MlflowClient(registry_uri="databricks-uc")
        champion_mv = client.get_model_version_by_alias(MODEL_NAME, "champion")
        champion_version = champion_mv.version
        champion_hash = (champion_mv.tags or {}).get("feature_schema_hash")
        if champion_hash != FEATURE_SCHEMA_HASH:
            raise ValueError(
                f"@champion feature schema mismatch: model has {champion_hash}, code has {FEATURE_SCHEMA_HASH}. "
                "Retrain and promote a compatible champion before scoring."
            )
        champion = mlflow.pyfunc.load_model(f"models:/{MODEL_NAME}@champion")
        score_input = future[FEATURES].copy()
        for c in CATEGORIES:
            score_input[c] = score_input[c].astype(str)
        preds = champion.predict(score_input)
        future["forecast_units"] = preds["forecast_units"].to_numpy()
        future["forecast_p90"] = preds["forecast_p90"].to_numpy()
        future["top_driver"] = preds["top_driver"].to_numpy()
        future["top_driver_contribution"] = preds["top_driver_contribution"].to_numpy()
        mlflow.log_metrics({"forecast_rows": len(future), "forecast_total_units": float(future["forecast_units"].sum())})

        run_id = score_run.info.run_id
        generated_at = pd.Timestamp.utcnow().tz_localize(None)
        forecasts = future[["location_id", "sku_id", "channel_type", "origin_week", "target_week", "horizon",
                            "forecast_units", "forecast_p90", "seasonal_naive", "event_naive",
                            "top_driver", "top_driver_contribution"]].copy()
        for c in ["location_id", "sku_id", "channel_type"]:
            forecasts[c] = forecasts[c].astype(str)
        forecasts = forecasts.rename(columns={"origin_week": "as_of_date", "target_week": "forecast_week",
                                              "seasonal_naive": "baseline_seasonal_naive", "event_naive": "baseline_event_naive"})
        forecasts.insert(0, "forecast_run_id", run_id)
        forecasts["model_name"] = MODEL_NAME
        forecasts["model_version"] = str(champion_version)
        forecasts["generated_at"] = generated_at
        (spark.createDataFrame(forecasts)
         .withColumn("as_of_date", F.to_date("as_of_date")).withColumn("forecast_week", F.to_date("forecast_week"))
         .write.mode("append").option("mergeSchema", "true").saveAsTable(f"{CATALOG}.gold.demand_forecasts"))
        spark.sql(f"""
        CREATE OR REPLACE VIEW {CATALOG}.gold.demand_forecasts_current
        COMMENT 'Latest forecast_run_id from append-only gold.demand_forecasts. Use this for current Genie and planner reads.'
        AS
        SELECT *
        FROM {CATALOG}.gold.demand_forecasts
        WHERE forecast_run_id = (
          SELECT forecast_run_id
          FROM {CATALOG}.gold.demand_forecasts
          QUALIFY row_number() OVER (ORDER BY generated_at DESC, forecast_run_id DESC) = 1
        )
        """)
        dbutils.notebook.exit(json.dumps({
            "mode": MODE, "final_run_id": run_id, "model": MODEL_NAME, "model_version": str(champion_version),
            "alias": "champion", "feature_schema_hash": FEATURE_SCHEMA_HASH, "forecast_rows": len(forecasts),
            "forecast_weeks": sorted(forecasts["forecast_week"].astype(str).unique().tolist()),
        }))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Model, metrics, and the pyfunc wrapper registered to Unity Catalog

# COMMAND ----------

PARAMS = {"learning_rate": 0.06, "num_leaves": 63, "min_data_in_leaf": 200, "feature_fraction": 0.8,
          "bagging_fraction": 0.8, "bagging_freq": 1, "lambda_l2": 1.0, "verbose": -1, "seed": SEED,
          "num_threads": 0}
MEAN_PARAMS = {**PARAMS, "objective": "tweedie", "tweedie_variance_power": 1.3}
P90_PARAMS = {**PARAMS, "objective": "quantile", "alpha": 0.9}
MEAN_ROUNDS, P90_ROUNDS = 500, 400


def fit(train):
    ds = lgb.Dataset(train[FEATURES], label=train["actual"], categorical_feature=CAT_FEATURES, free_raw_data=False)
    mean_model = lgb.train(MEAN_PARAMS, ds, num_boost_round=MEAN_ROUNDS)
    p90_model = lgb.train(P90_PARAMS, ds, num_boost_round=P90_ROUNDS)
    return mean_model, p90_model


def predict(models, df):
    mean_model, p90_model = models
    f = np.clip(mean_model.predict(df[FEATURES]), 0, None)
    p90 = np.maximum(np.clip(p90_model.predict(df[FEATURES]), 0, None), f)
    return f, p90


def wmape(y, f):
    return float(np.abs(y - f).sum() / max(y.sum(), 1e-9))


def bias(y, f):
    return float((f - y).sum() / max(y.sum(), 1e-9))


def accuracy_table(df, actual_col="actual"):
    """WMAPE / bias by segment for the model and both baselines."""
    segs = [("ALL", "ALL", np.ones(len(df), bool))]
    segs += [("CHANNEL", c, (df["channel_type"] == c).to_numpy()) for c in CATEGORIES["channel_type"]]
    segs += [("HORIZON", str(h), (df["horizon"] == h).to_numpy()) for h in range(1, HORIZON + 1)]
    segs += [("SEGMENT", "PEAK_GIFT_IN_EVENT_WINDOW", ((df["peak_gift_flag"] == 1) & (df["t_in_event_window"] == 1)).to_numpy())]
    rows = []
    for seg_type, seg, m in segs:
        d = df[m]
        y = d[actual_col].to_numpy()
        for method, col_name in [("model", "forecast"), ("seasonal_naive", "seasonal_naive"), ("event_naive", "event_naive")]:
            rows.append({"segment_type": seg_type, "segment": seg, "method": method, "rows": len(d),
                         "actual_units": float(y.sum()), "wmape": wmape(y, d[col_name].to_numpy()),
                         "bias": bias(y, d[col_name].to_numpy())})
        rows.append({"segment_type": seg_type, "segment": seg, "method": "model_p90_coverage", "rows": len(d),
                     "actual_units": float(y.sum()), "wmape": float((y <= d["forecast_p90"].to_numpy()).mean()), "bias": None})
    return pd.DataFrame(rows)


def apply_p90_calibration(df, calibration):
    peak = (df["peak_gift_flag"] == 1) & (df["t_in_event_window"] == 1)
    uplift = np.where(peak, calibration.get("peak_event", 0.0), calibration.get("rest", 0.0))
    out = df.copy()
    out["forecast_p90_raw"] = out["forecast_p90"]
    out["forecast_p90"] = np.maximum(out["forecast_p90"] + uplift, out["forecast"])
    return out


class DemandForecaster(mlflow.pyfunc.PythonModel):
    """Expected weekly units (Tweedie) and p90 (quantile) for store-SKU-horizon rows."""

    def __init__(self, mean_model, p90_model, features, categories, p90_calibration=None, feature_schema_hash=None):
        self.mean_model, self.p90_model = mean_model, p90_model
        self.features, self.categories = features, categories
        self.p90_calibration = p90_calibration or {"peak_event": 0.0, "rest": 0.0}
        self.feature_schema_hash = feature_schema_hash

    def predict(self, context, model_input, params=None):
        x = model_input[self.features].copy()
        for c, cats in self.categories.items():
            x[c] = pd.Categorical(x[c].astype(str), categories=cats)
        f = np.clip(self.mean_model.predict(x), 0, None)
        p90 = np.maximum(np.clip(self.p90_model.predict(x), 0, None), f)
        if {"peak_gift_flag", "t_in_event_window"}.issubset(model_input.columns):
            peak = (model_input["peak_gift_flag"].astype(int) == 1) & (model_input["t_in_event_window"].astype(int) == 1)
            uplift = np.where(peak, self.p90_calibration.get("peak_event", 0.0), self.p90_calibration.get("rest", 0.0))
            p90 = p90 + uplift
        contrib = self.mean_model.predict(x, pred_contrib=True)[:, :-1]
        top = np.abs(contrib).argmax(axis=1)
        features = np.array(self.features)
        return pd.DataFrame({
            "forecast_units": f,
            "forecast_p90": p90,
            "top_driver": [driver_group(feature) for feature in features[top]],
            "top_driver_contribution": contrib[np.arange(len(x)), top],
        })


def model_input(df):
    x = df[FEATURES].copy()
    for c in CATEGORIES:
        x[c] = x[c].astype(str)
    return x


def predict_pyfunc(model, df):
    pred = model.predict(model_input(df))
    return pred["forecast_units"].to_numpy(), pred["forecast_p90"].to_numpy()

# COMMAND ----------

# MAGIC %md
# MAGIC ## Ground truth for the censoring check
# MAGIC
# MAGIC Synthetic data lets us score against true (uncensored) demand. It is used for evaluation only, never for training.

# COMMAND ----------

truth = (spark.read.csv(f"/Volumes/{CATALOG}/eval/ground_truth/", header=True, inferSchema=True)
         .select("location_id", "sku_id", F.to_date("week_start").alias("target_week"), "true_units").toPandas())
truth["target_week"] = pd.to_datetime(truth["target_week"])

# COMMAND ----------

# MAGIC %md
# MAGIC ## Rolling backtest

# COMMAND ----------

with mlflow.start_run(run_name="backtest") as backtest_run:
    mlflow.log_params({"horizon_weeks": HORIZON, "censored_oos_days": CENSORED_OOS_DAYS, "features": len(FEATURES),
                       "mean_objective": "tweedie(1.3)", "p90_objective": "quantile(0.9)",
                       "mean_rounds": MEAN_ROUNDS, "p90_rounds": P90_ROUNDS, **{f"lgb_{k}": v for k, v in PARAMS.items()}})
    fold_tables_raw, fold_preds, fold_summary = [], [], {}
    for name, first, last in FOLDS:
        first_ts, last_ts = pd.Timestamp(first), pd.Timestamp(last)
        with mlflow.start_run(run_name=f"fold_{name}", nested=True):
            train = trainable(history[history["target_week"] < first_ts])
            test = history[(history["origin_week"] >= first_ts) & (history["origin_week"] <= last_ts)].copy()
            models = fit(train)
            test["forecast"], test["forecast_p90"] = predict(models, test)
            scored = observed_scored(test)
            acc = accuracy_table(scored).assign(fold=name, scored_against="observed_uncensored", calibration="raw_quantile")
            # Censoring check: all test weeks (including censored) against true demand.
            vs_truth = test.merge(truth, on=["location_id", "sku_id", "target_week"], how="inner")
            acc_truth = accuracy_table(vs_truth, actual_col="true_units").assign(fold=name, scored_against="true_demand_all_weeks", calibration="raw_quantile")
            table = pd.concat([acc, acc_truth], ignore_index=True)
            mlflow.log_params({"fold": name, "first_origin": first, "last_origin": last,
                               "train_rows": len(train), "test_rows": len(scored)})
            for r in table[table["segment_type"].isin(["ALL", "CHANNEL", "SEGMENT"])].itertuples():
                tag = "truth_" if r.scored_against == "true_demand_all_weeks" else ""
                mlflow.log_metric(f"{tag}wmape_{r.method}_{r.segment}" if r.method != "model_p90_coverage"
                                  else f"{tag}p90_coverage_{r.segment}", r.wmape)
            mlflow.log_table(table, artifact_file=f"accuracy_{name}.json")
            overall = table[(table.segment == "ALL") & (table.scored_against == "observed_uncensored")].set_index("method")["wmape"]
            fold_summary[name] = {k: round(v, 4) for k, v in overall.items()}
            fold_tables_raw.append(table)
            fold_preds.append(test.assign(fold=name))
    backtest_pred = pd.concat(fold_preds, ignore_index=True)
    residual_source = backtest_pred.merge(truth, on=["location_id", "sku_id", "target_week"], how="inner")
    residual_source["p90_gap"] = (residual_source["true_units"] - residual_source["forecast_p90"]).clip(lower=0)
    peak_mask = (residual_source["peak_gift_flag"] == 1) & (residual_source["t_in_event_window"] == 1)
    p90_uplift_peak = float(np.nanquantile(residual_source.loc[peak_mask, "p90_gap"], 0.90)) if peak_mask.any() else 0.0
    p90_uplift_rest = float(np.nanquantile(residual_source.loc[~peak_mask, "p90_gap"], 0.90)) if (~peak_mask).any() else 0.0
    p90_calibration = {"peak_event": round(p90_uplift_peak, 4), "rest": round(p90_uplift_rest, 4)}
    mlflow.log_params({f"p90_conformal_uplift_{k}": v for k, v in p90_calibration.items()})
    calibrated_preds = [apply_p90_calibration(p, p90_calibration) for p in fold_preds]
    calibrated_tables = []
    fold_summary = {}
    for name, pred in zip([f[0] for f in FOLDS], calibrated_preds):
        scored = observed_scored(pred)
        acc = accuracy_table(scored).assign(fold=name, scored_against="observed_uncensored", calibration="post_conformal")
        vs_truth = pred.merge(truth, on=["location_id", "sku_id", "target_week"], how="inner")
        acc_truth = accuracy_table(vs_truth, actual_col="true_units").assign(fold=name, scored_against="true_demand_all_weeks", calibration="post_conformal")
        table = pd.concat([acc, acc_truth], ignore_index=True)
        calibrated_tables.append(table)
        overall = table[(table.segment == "ALL") & (table.scored_against == "observed_uncensored")].set_index("method")["wmape"]
        fold_summary[name] = {k: round(v, 4) for k, v in overall.items()}
    fold_preds = calibrated_preds
    backtest_acc = pd.concat(fold_tables_raw + calibrated_tables, ignore_index=True)
    mlflow.log_table(backtest_acc, artifact_file="accuracy_all_folds.json")
    for name, s in fold_summary.items():
        mlflow.log_metric(f"wmape_model_ALL_{name}", s["model"])
        mlflow.log_metric(f"wmape_seasonal_naive_ALL_{name}", s["seasonal_naive"])
print(json.dumps(fold_summary, indent=2))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Final model: train on all history, register `@champion`, score six weeks

# COMMAND ----------

with mlflow.start_run(run_name="final_train_and_score") as final_run:
    train = trainable(history)
    models = fit(train)
    mean_model, p90_model = models
    mlflow.log_params({"mode": MODE, "train_rows": len(train), "train_target_weeks": f"{train.target_week.min().date()}..{train.target_week.max().date()}",
                       "as_of": str(AS_OF.date()), "backtest_run_id": backtest_run.info.run_id,
                       "mean_objective": "tweedie(1.3)", "p90_objective": "quantile(0.9)",
                       "mean_rounds": MEAN_ROUNDS, "p90_rounds": P90_ROUNDS,
                       **{f"p90_conformal_uplift_{k}": v for k, v in p90_calibration.items()}})
    for name, s in fold_summary.items():
        for method, v in s.items():
            mlflow.log_metric(f"backtest_{name}_{'p90_coverage' if method == 'model_p90_coverage' else 'wmape_' + method}", v)
    importance = pd.DataFrame({"feature": FEATURES, "gain": mean_model.feature_importance("gain")}).sort_values("gain", ascending=False)
    mlflow.log_table(importance, artifact_file="feature_importance.json")

    forecaster = DemandForecaster(mean_model, p90_model, FEATURES, CATEGORIES, p90_calibration, FEATURE_SCHEMA_HASH)
    example = model_input(train.head(50))
    info = mlflow.pyfunc.log_model(
        name="model",
        python_model=forecaster,
        input_example=example,
        signature=infer_signature(example, forecaster.predict(None, example)),
        pip_requirements=[f"lightgbm=={lgb.__version__}", f"pandas=={pd.__version__}", f"numpy=={np.__version__}"],
        registered_model_name=MODEL_NAME,
    )
    client = MlflowClient(registry_uri="databricks-uc")
    version = info.registered_model_version
    client.set_model_version_tag(MODEL_NAME, version, "feature_schema_hash", FEATURE_SCHEMA_HASH)
    client.set_model_version_tag(MODEL_NAME, version, "feature_schema_version", "forecast_features_v2_event_week_uncensored")
    current_champion = None
    champion_feature_hash = None
    try:
        current = client.get_model_version_by_alias(MODEL_NAME, "champion")
        current_champion = current.version
        champion_feature_hash = (current.tags or {}).get("feature_schema_hash")
    except Exception:
        pass
    candidate_wmape = float(np.mean([s["model"] for s in fold_summary.values()]))
    champion_wmape = None
    if current_champion:
        try:
            champion_model = mlflow.pyfunc.load_model(f"models:/{MODEL_NAME}@champion")
            champion_wmapes = []
            for pred in fold_preds:
                scored = observed_scored(pred).copy()
                scored["forecast"], _ = predict_pyfunc(champion_model, scored)
                champion_wmapes.append(wmape(scored["actual"].to_numpy(), scored["forecast"].to_numpy()))
            champion_wmape = float(np.mean(champion_wmapes))
        except Exception as e:
            mlflow.set_tag("champion_gate_warning", f"failed like-for-like champion scoring: {str(e)[:200]}")
    schema_migration_required = current_champion is None or champion_feature_hash != FEATURE_SCHEMA_HASH
    promote = MODE != "score_only" and (
        schema_migration_required or (champion_wmape is not None and candidate_wmape <= champion_wmape + PROMOTE_TOLERANCE)
    )
    if promote:
        client.set_registered_model_alias(MODEL_NAME, "champion", version)
    mlflow.log_params({"model_version": version, "previous_champion_version": current_champion,
                       "feature_schema_hash": FEATURE_SCHEMA_HASH,
                       "candidate_feature_schema_hash": FEATURE_SCHEMA_HASH,
                       "champion_feature_schema_hash": champion_feature_hash,
                       "schema_migration_required": schema_migration_required,
                       "candidate_mean_wmape": candidate_wmape, "champion_mean_wmape": champion_wmape,
                       "promoted_to_champion": promote})
    client.update_model_version(MODEL_NAME, version, description=(
        f"Global LightGBM demand forecaster (Tweedie mean + p90 quantile), horizons 1-{HORIZON} weeks. "
        f"Backtest WMAPE: " + ", ".join(f"{k} model {v['model']:.3f} vs seasonal-naive {v['seasonal_naive']:.3f}" for k, v in fold_summary.items())))

    # Score from the as-of date with the registered @champion model.
    future = design([K_HIST])
    score_version = str(version if promote or not current_champion else current_champion)
    scoring_uri = info.model_uri if promote or not current_champion else f"models:/{MODEL_NAME}@champion"
    champion = mlflow.pyfunc.load_model(scoring_uri)
    preds = champion.predict(model_input(future))
    future["forecast_units"] = preds["forecast_units"].to_numpy()
    future["forecast_p90"] = preds["forecast_p90"].to_numpy()
    future["top_driver"] = preds["top_driver"].to_numpy()
    future["top_driver_contribution"] = preds["top_driver_contribution"].to_numpy()
    mlflow.log_metrics({"forecast_rows": len(future), "forecast_total_units": float(future["forecast_units"].sum())})

# COMMAND ----------

# MAGIC %md
# MAGIC ## Write Gold and ML tables

# COMMAND ----------

run_id = final_run.info.run_id
generated_at = pd.Timestamp.utcnow().tz_localize(None)

forecasts = future[["location_id", "sku_id", "channel_type", "origin_week", "target_week", "horizon",
                    "forecast_units", "forecast_p90", "seasonal_naive", "event_naive", "top_driver", "top_driver_contribution"]].copy()
for c in ["location_id", "sku_id", "channel_type"]:
    forecasts[c] = forecasts[c].astype(str)
forecasts = forecasts.rename(columns={"origin_week": "as_of_date", "target_week": "forecast_week",
                                      "seasonal_naive": "baseline_seasonal_naive", "event_naive": "baseline_event_naive"})
forecasts.insert(0, "forecast_run_id", run_id)
forecasts["model_name"] = MODEL_NAME
forecasts["model_version"] = score_version
forecasts["generated_at"] = generated_at
(spark.createDataFrame(forecasts)
 .withColumn("as_of_date", F.to_date("as_of_date")).withColumn("forecast_week", F.to_date("forecast_week"))
 .write.mode("append").option("mergeSchema", "true").saveAsTable(f"{CATALOG}.gold.demand_forecasts"))

spark.sql(f"""
CREATE OR REPLACE VIEW {CATALOG}.gold.demand_forecasts_current
COMMENT 'Latest forecast_run_id from append-only gold.demand_forecasts. Use this for current Genie and planner reads.'
AS
SELECT *
FROM {CATALOG}.gold.demand_forecasts
WHERE forecast_run_id = (
  SELECT forecast_run_id
  FROM {CATALOG}.gold.demand_forecasts
  QUALIFY row_number() OVER (ORDER BY generated_at DESC, forecast_run_id DESC) = 1
)
""")

acc_out = backtest_acc.assign(backtest_run_id=backtest_run.info.run_id, model_name=MODEL_NAME,
                              model_version=str(version), generated_at=generated_at)
spark.createDataFrame(acc_out).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{CATALOG}.gold.forecast_accuracy")

bt = pd.concat(fold_preds, ignore_index=True)[["fold", "location_id", "sku_id", "channel_type", "peak_gift_flag", "origin_week",
                                                "target_week", "horizon", "actual", "censored", "forecast", "forecast_p90",
                                                "seasonal_naive", "event_naive", "t_in_event_window", "lead_time_days",
                                                "shelf_life_days", "case_pack_units", "unit_cost", "list_price"]]
for c in ["location_id", "sku_id", "channel_type"]:
    bt[c] = bt[c].astype(str)
bt = bt.merge(truth, on=["location_id", "sku_id", "target_week"], how="left")
(spark.createDataFrame(bt).withColumn("origin_week", F.to_date("origin_week")).withColumn("target_week", F.to_date("target_week"))
 .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{CATALOG}.ml.backtest_forecasts"))

policy = bt.dropna(subset=["true_units"]).copy()
policy["lead_weeks"] = np.ceil(policy["lead_time_days"].astype(float) / 7.0).astype(int)
policy["decision_horizon"] = np.clip(policy["lead_weeks"] + 1, 1, HORIZON)
policy = policy[policy["horizon"].astype(int) == policy["decision_horizon"]].copy()
policy = policy.sort_values(["fold", "location_id", "sku_id", "target_week"])


def replay_policy(group, plan_col):
    rows = []
    cohorts = []  # (qty, weeks_left)
    for r in group.itertuples(index=False):
        case_pack = max(float(r.case_pack_units), 1.0)
        shelf_weeks = max(int(np.ceil(float(r.shelf_life_days) / 7.0)), 1)
        on_hand = sum(q for q, _ in cohorts)
        plan = max(float(getattr(r, plan_col)), 0.0)
        order = np.ceil(max(0.0, plan - on_hand) / case_pack) * case_pack
        if order > 0:
            cohorts.append((order, shelf_weeks))
        demand = float(r.true_units)
        available = sum(q for q, _ in cohorts)
        sold = min(demand, available)
        lost = max(0.0, demand - available)
        remaining_to_sell = sold
        new_cohorts = []
        waste = 0.0
        for qty, weeks_left in sorted(cohorts, key=lambda x: x[1]):
            take = min(qty, remaining_to_sell)
            qty -= take
            remaining_to_sell -= take
            weeks_left -= 1
            if qty > 1e-9 and weeks_left > 0:
                new_cohorts.append((qty, weeks_left))
            elif qty > 1e-9:
                waste += qty
        rows.append({**r._asdict(), "order_units": order, "lost_units": lost, "waste_units": waste})
        cohorts = new_cohorts
    return pd.DataFrame(rows)


policy["manual_plan_units"] = policy["seasonal_naive"] * 1.25
policy["forecast_plan_units"] = policy["forecast_p90"]
manual = policy.groupby(["fold", "location_id", "sku_id"], group_keys=False).apply(replay_policy, "manual_plan_units")
forecast_policy = policy.groupby(["fold", "location_id", "sku_id"], group_keys=False).apply(replay_policy, "forecast_plan_units")
manual["policy"] = "manual"
forecast_policy["policy"] = "forecast"
policy_replay = pd.concat([manual, forecast_policy], ignore_index=True)
policy_replay["lost_sales"] = policy_replay["lost_units"] * policy_replay["list_price"].astype(float)
policy_replay["waste_value"] = policy_replay["waste_units"] * policy_replay["unit_cost"].astype(float)
policy_window_weeks = policy.groupby("fold")["target_week"].nunique().rename("window_weeks").reset_index()
summary_long = (
    policy_replay.groupby(["fold", "channel_type", "policy"], as_index=False)
    .agg(lost_sales=("lost_sales", "sum"), waste_value=("waste_value", "sum"))
    .merge(policy_window_weeks, on="fold")
)
summary_long["annualized_lost_sales"] = summary_long["lost_sales"] * 52 / summary_long["window_weeks"]
summary_long["annualized_waste_value"] = summary_long["waste_value"] * 52 / summary_long["window_weeks"]
policy_summary = (
    summary_long.pivot(index=["fold", "channel_type", "window_weeks"], columns="policy",
                       values=["lost_sales", "waste_value", "annualized_lost_sales", "annualized_waste_value"])
    .reset_index()
)
policy_summary.columns = ["_".join([str(x) for x in c if x]).strip("_") for c in policy_summary.columns]
policy_summary["annualized_lost_sales_delta"] = policy_summary["annualized_lost_sales_manual"] - policy_summary["annualized_lost_sales_forecast"]
policy_summary["annualized_waste_delta"] = policy_summary["annualized_waste_value_manual"] - policy_summary["annualized_waste_value_forecast"]
policy_summary = policy_summary.rename(columns={
    "lost_sales_manual": "manual_lost_sales",
    "lost_sales_forecast": "forecast_lost_sales",
    "waste_value_manual": "manual_waste_value",
    "waste_value_forecast": "forecast_waste_value",
})
spark.createDataFrame(policy_summary).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(
    f"{CATALOG}.gold.business_impact_summary"
)

for t, c in [("gold.demand_forecasts", "Six-week store-SKU forecasts (expected units and p90) from the @champion model; append-only by forecast_run_id."),
             ("gold.forecast_accuracy", "Backtest WMAPE / bias / p90 coverage by fold, calibration, channel, horizon, and segment: model vs seasonal-naive and event-aligned naive."),
             ("ml.backtest_forecasts", "Rolling-origin backtest predictions with actuals, censoring flag, and synthetic true demand."),
             ("gold.business_impact_summary", "Policy backtest comparing forecast-driven orders with manual seasonal-naive ordering by fold and channel.")]:
    spark.sql(f"COMMENT ON TABLE {CATALOG}.{t} IS '{c}'")

dbutils.notebook.exit(json.dumps({
    "experiment_id": experiment_id, "backtest_run_id": backtest_run.info.run_id, "final_run_id": run_id,
    "model": MODEL_NAME, "model_version": str(version), "scored_model_version": score_version,
    "alias": "champion", "promoted_to_champion": bool(promote),
    "feature_schema_hash": FEATURE_SCHEMA_HASH, "p90_conformal_uplift": p90_calibration,
    "backtest_wmape": fold_summary, "forecast_rows": len(forecasts),
    "forecast_weeks": sorted(forecasts["forecast_week"].astype(str).unique().tolist()),
}))
