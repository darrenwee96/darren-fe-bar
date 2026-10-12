# /// script
# requires-python = ">=3.10"
# ///
"""Build, check, and deploy the curated Eastwind Gourmet Genie Agent.

    uv run genie/build_space.py                 # write genie/serialized_space.json
    uv run genie/build_space.py --check         # also run every example / benchmark SQL on the warehouse
    uv run genie/build_space.py --deploy        # create the space, or update it if genie/space_id.txt exists

All content (sources, column context, joins, snippets, examples, instructions, benchmarks) lives here so the
space is reproducible. IDs are derived from content keys, so re-deploying updates items instead of duplicating them.
"""

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

PROFILE = "fe-bar"
WAREHOUSE_ID = "221da0ceb437f8a8"
C = "darren_fe_bar_catalog"
TITLE = "Eastwind Gourmet: Demand & Replenishment"
PARENT_PATH = "/Workspace/Users/darren.wee@databricks.com/eastwind-gourmet"
HERE = Path(__file__).parent

DESCRIPTION = (
    "Answers merchandising questions for Eastwind Gourmet's 80 stores (32 downtown, 26 highway, 22 airport): "
    "weekly net sales, stockouts and waste by channel and region; demand-forecast accuracy against last-year "
    "baselines; the current 6-week store-SKU forecast and order recommendations with stockout/overstock risk; "
    "and store managers' accept / adjust / reject decisions. Actual sales run to the week of 2026-08-24; "
    "forecasts and recommendations are as of 2026-08-31. Synthetic data."
)


def iid(key: str) -> str:
    return hashlib.md5(key.encode()).hexdigest()


def col(name, description=None, synonyms=None, match=False, exclude=False):
    c = {"column_name": name}
    if description:
        c["description"] = [description]
    if synonyms:
        c["synonyms"] = synonyms
    if match:
        c["enable_format_assistance"] = True
        c["enable_entity_matching"] = True
    if exclude:
        c["exclude"] = True
    return c


TABLES = {
    f"{C}.gold.channel_weekly_kpis": {
        "description": "One row per week (Monday week_start) x channel_type x region. Sum the money and unit "
        "columns across rows; rates must be weighted by ranged_series, never averaged.",
        "columns": [
            col("week_start", "Monday of the sales week.", ["week"]),
            col("channel_type", "Store channel: DOWNTOWN, HIGHWAY or AIRPORT.", ["channel", "format"], match=True),
            col("region", "Store region: North, Central, South or East.", match=True),
            col("net_sales", "Net sales after markdown discounts, USD.", ["revenue", "sales"]),
            col("peak_gift_net_sales", "Net sales of peak gift SKUs (mooncakes, LNY hampers, etc.), USD."),
            col("units_sold", "Units sold.", ["volume"]),
            col("ranged_series", "Number of store-SKU combinations ranged that week; the weight for the rate columns."),
            col("peak_gift_ranged_series", "Number of peak gift store-SKU combinations ranged that week; weight for peak_gift_stockout_day_rate."),
            col(
                "stockout_day_rate",
                "Share of store-SKU-days with no stock on hand. Weighted roll-up: "
                "SUM(stockout_day_rate * ranged_series) / SUM(ranged_series).",
                ["stockout rate", "out of stock rate", "OOS rate"],
            ),
            col(
                "peak_gift_stockout_day_rate",
                "Share of peak gift SKU-days with no stock on hand. Weighted roll-up: "
                "SUM(peak_gift_stockout_day_rate * peak_gift_ranged_series) / SUM(peak_gift_ranged_series).",
                ["peak gift stockout rate", "Mid-Autumn stockout rate"],
            ),
            col(
                "censored_series_share",
                "Share of store-SKUs with 2+ out-of-stock days that week (censored: sales understate demand).",
                ["censored share"],
            ),
            col("expired_value", "Stock written off at expiry, at cost, USD.", ["expiry", "write-off"]),
            col("markdown_value", "Discount given on near-expiry stock, USD.", ["markdowns"]),
            col("waste_value", "expired_value + markdown_value, USD.", ["waste", "shrink"]),
        ],
    },
    f"{C}.gold.forecast_accuracy": {
        "description": "Rolling-origin backtest accuracy of the forecast model and two baselines. Folds: MA2025 "
        "(Mid-Autumn 2025, festival 2025-10-06) and LNY2026 (Lunar New Year 2026, 2026-02-17). One row per "
        "fold x scored_against x segment_type x segment x method.",
        "columns": [
            col("fold", "Backtest fold: MA2025 (Mid-Autumn 2025) or LNY2026 (Lunar New Year 2026).", match=True),
            col("calibration", "raw_quantile before conformal p90 calibration or post_conformal after segmented conformal uplift.", match=True),
            col(
                "scored_against",
                "observed_uncensored = scored against recorded sales in weeks with < 2 stockout days (the "
                "real-world measure, use by default); true_demand_all_weeks = scored against simulated true demand, "
                "only possible because the data is synthetic.",
                match=True,
            ),
            col("segment_type", "ALL, CHANNEL, HORIZON (weeks ahead 1-6) or SEGMENT.", match=True),
            col(
                "segment",
                "Value within segment_type: ALL; AIRPORT/DOWNTOWN/HIGHWAY; '1'..'6'; or "
                "PEAK_GIFT_IN_EVENT_WINDOW (peak gift SKUs in the weeks around the holiday).",
                match=True,
            ),
            col(
                "method",
                "model = LightGBM forecast; seasonal_naive = same calendar week last year; event_naive = same "
                "week relative to the same holiday last year; model_p90_coverage = share of actuals at or below "
                "the model's p90 (target 0.90), stored in the wmape column.",
                ["baseline"],
                match=True,
            ),
            col("rows", "Store-SKU-week forecasts scored."),
            col("actual_units", "Sum of actual units scored."),
            col(
                "wmape",
                "Weighted MAPE = sum|actual - forecast| / sum(actual); lower is better. For "
                "method = model_p90_coverage this column is p90 coverage instead.",
                ["accuracy", "error", "forecast error"],
            ),
            col("bias", "(sum forecast - sum actual) / sum actual; negative = under-forecast. Null for p90 coverage."),
            col("backtest_run_id", exclude=True),
            col("model_name", exclude=True),
            col("generated_at", exclude=True),
        ],
    },
    f"{C}.gold.demand_forecasts_current": {
        "description": "Current 6-week forecast per store-SKU-week from the @champion model, as of 2026-08-31. "
        "Join silver.dim_location / silver.dim_product for names, region, and category.",
        "columns": [
            col("location_id", "Store key."),
            col("sku_id", "Product key."),
            col("channel_type", "Store channel.", match=True),
            col("as_of_date", "Forecast origin (last actual week ends the day before)."),
            col("forecast_week", "Monday of the forecast week.", ["week"]),
            col("horizon", "Weeks ahead, 1-6."),
            col("forecast_units", "Expected demand in units (mean).", ["forecast", "expected demand"]),
            col("forecast_p90", "90th-percentile demand: plan-for level with 10% chance of exceeding.", ["p90", "upper"]),
            col("baseline_seasonal_naive", "Units sold in the same calendar week last year.", ["last year"]),
            col("baseline_event_naive", "Units sold in the same week relative to the same holiday last year."),
            col("top_driver", "Model feature that moved this forecast most."),
            col("top_driver_contribution", exclude=True),
            col("forecast_run_id", exclude=True),
            col("model_name", exclude=True),
            col("generated_at", exclude=True),
        ],
    },
    f"{C}.gold.replenishment_recommendations_current": {
        "description": "One current order recommendation per store-SKU (2,247 rows), as of 2026-08-31. "
        "recommended_units = units to order now in case packs; 0 means no order needed.",
        "columns": [
            col("recommendation_id", "Key; joins order_decisions_history."),
            col("location_name", "Store name.", ["store"], match=True),
            col("channel_type", "Store channel.", ["channel"], match=True),
            col("region", "Store region.", match=True),
            col("sku_name", "Product name.", ["product", "item"], match=True),
            col("category", "Product category, e.g. Mooncake, Pastry, Hamper, Tea.", match=True),
            col("peak_gift_flag", "True for the peak-season gift SKUs."),
            col("on_hand_units", "Stock on hand at the as-of date."),
            col("inbound_units", "Stock already ordered and in transit."),
            col("demand_cover_units", "Forecast demand over the cover period (lead time + 1 week)."),
            col("safety_units", "Safety stock from forecast uncertainty (p90 vs expected)."),
            col("demand_6w_units", "Forecast demand over all 6 weeks."),
            col("recommended_units", "Units to order now, rounded up to case packs.", ["order quantity", "order"]),
            col(
                "cap_applied",
                "SHELF_LIFE = order cut so stock can sell before it expires; NONE otherwise.",
                match=True,
            ),
            col(
                "stockout_risk",
                "HIGH = stock on hand + inbound is below cover-period demand; MEDIUM = below demand + safety stock; "
                "LOW otherwise. Measured before the recommended order.",
                match=True,
            ),
            col(
                "overstock_risk",
                "HIGH = short-life stock exceeds what sells before expiry; MEDIUM = stock exceeds 6-week demand.",
                match=True,
            ),
            col(
                "est_lost_sales_if_no_order",
                "Sales at risk at list price if nothing is ordered, USD.",
                ["sales at risk", "lost sales"],
            ),
            col("est_expiry_value", "Current stock expected to expire unsold, at cost, USD.", ["expected waste"]),
            col("unit_cost", "Unit cost, USD. Order value at cost = recommended_units * unit_cost."),
            col("list_price", "Unit list price, USD."),
            col("top_driver", "Plain-language main driver of the forecast.", match=True),
            col("explanation_text", "Planner-facing explanation of the recommendation."),
            col("forecast_run_id", exclude=True),
            col("raw_need_units", exclude=True),
            col("sellable_before_expiry_units", exclude=True),
        ],
    },
    f"{C}.gold.order_decisions_history": {
        "description": "Current store-manager decision per recommendation, written in the replenishment app "
        "(Lakebase) and copied to Unity Catalog. A recommendation with no row here is still pending.",
        "columns": [
            col("recommendation_id", "Joins replenishment_recommendations_current."),
            col(
                "decision_status",
                "ACCEPTED (ordered as recommended), ADJUSTED (different quantity) or REJECTED (no order). "
                "Overrides = ADJUSTED + REJECTED.",
                ["decision"],
                match=True,
            ),
            col("recommended_units", "Recommended quantity at decision time."),
            col("final_order_units", "Quantity the manager committed to.", ["final order"]),
            col("reason", "Manager's reason for adjusting or rejecting.", ["override reason"]),
            col("decided_by", "Email of the manager who decided."),
            col("decided_at", "When the decision was saved."),
            col("decision_id", exclude=True),
            col("updated_at", exclude=True),
            col("version", exclude=True),
        ],
    },
    f"{C}.gold.business_impact_summary": {
        "description": "Policy backtest summary comparing forecast-driven replenishment with manual seasonal-naive ordering by fold and channel. "
        "Rows are fold-window summaries; do not sum annualized columns across folds. For pooled annualized impact by channel, sum raw deltas "
        "and multiply by 52 / sum(window_weeks). For an all-channel total, sum channel-level pooled annualized values or use distinct fold weeks, not channel-duplicated window_weeks.",
        "columns": [
            col("fold", "Backtest fold.", match=True),
            col("channel_type", "Store channel.", match=True),
            col("window_weeks", "Distinct target weeks in the fold window. Use as denominator for pooled annualization."),
            col("manual_lost_sales", "Lost sales under manual ordering, USD."),
            col("forecast_lost_sales", "Lost sales under forecast-driven ordering, USD."),
            col("lost_sales_delta", "Raw in-window lost-sales reduction from forecast policy, USD."),
            col("manual_waste_value", "Waste value under manual ordering, USD."),
            col("forecast_waste_value", "Waste value under forecast-driven ordering, USD."),
            col("waste_delta", "Raw in-window waste reduction from forecast policy, USD; negative means the forecast policy wastes more."),
            col("annualized_lost_sales_forecast", "Per-fold annualized forecast-policy lost sales, USD."),
            col("annualized_lost_sales_manual", "Per-fold annualized manual-policy lost sales, USD."),
            col("annualized_waste_value_forecast", "Per-fold annualized forecast-policy waste, USD."),
            col("annualized_waste_value_manual", "Per-fold annualized manual-policy waste, USD."),
            col("annualized_lost_sales_delta", "Per-fold annualized lost-sales reduction from forecast policy, USD. Do not sum across folds."),
            col("annualized_waste_delta", "Per-fold annualized waste reduction from forecast policy, USD. Do not sum across folds."),
        ],
    },
    f"{C}.silver.dim_location": {
        "description": "One row per store (80).",
        "columns": [
            col("location_name", "Store name.", ["store"], match=True),
            col("channel_type", "DOWNTOWN, HIGHWAY or AIRPORT.", ["channel"], match=True),
            col("region", match=True),
            col("capacity_tier", "Store size: S, M or L.", ["size"], match=True),
            col("timezone", exclude=True),
            col("pos_store_code", exclude=True),
        ],
    },
    f"{C}.silver.dim_product": {
        "description": "One row per SKU (32).",
        "columns": [
            col("sku_name", "Product name.", ["product"], match=True),
            col("category", match=True),
            col("peak_gift_flag", "True for the peak-season gift SKUs."),
            col("shelf_life_days", "Days from receipt to expiry."),
            col("lead_time_days", "Days from order to delivery."),
            col("case_pack_units", "Order multiple."),
        ],
    },
}

F = f"{C}.gold.demand_forecasts_current"
R = f"{C}.gold.replenishment_recommendations_current"
D = f"{C}.gold.order_decisions_history"
L = f"{C}.silver.dim_location"
P = f"{C}.silver.dim_product"
K = f"{C}.gold.channel_weekly_kpis"
A = f"{C}.gold.forecast_accuracy"

JOINS = [
    (F, "demand_forecasts", L, "dim_location", "`demand_forecasts`.`location_id` = `dim_location`.`location_id`", "MANY_TO_ONE"),
    (F, "demand_forecasts", P, "dim_product", "`demand_forecasts`.`sku_id` = `dim_product`.`sku_id`", "MANY_TO_ONE"),
    (
        F, "demand_forecasts", R, "replenishment_recommendations_current",
        "`demand_forecasts`.`location_id` = `replenishment_recommendations_current`.`location_id` AND "
        "`demand_forecasts`.`sku_id` = `replenishment_recommendations_current`.`sku_id`",
        "MANY_TO_ONE",
    ),
    (
        D, "order_decisions_history", R, "replenishment_recommendations_current",
        "`order_decisions_history`.`recommendation_id` = `replenishment_recommendations_current`.`recommendation_id`",
        "ONE_TO_ONE",
    ),
]

SNIPPETS = {
    "measures": [
        ("waste_rate", "Waste rate", "SUM(channel_weekly_kpis.waste_value) / SUM(channel_weekly_kpis.net_sales)", ["waste %", "waste share"]),
        (
            "stockout_rate_weighted", "Stockout day rate",
            "SUM(channel_weekly_kpis.stockout_day_rate * channel_weekly_kpis.ranged_series) / SUM(channel_weekly_kpis.ranged_series)",
            ["stockout rate", "OOS rate"],
        ),
        (
            "order_value_at_cost", "Order value at cost",
            "SUM(replenishment_recommendations_current.recommended_units * replenishment_recommendations_current.unit_cost)",
            ["order value", "spend"],
        ),
        (
            "override_rate", "Override rate",
            "COUNT_IF(order_decisions_history.decision_status IN ('ADJUSTED', 'REJECTED')) / COUNT(*)",
            ["override share"],
        ),
    ],
    "filters": [
        ("Observed accuracy (default)", "forecast_accuracy.scored_against = 'observed_uncensored' AND forecast_accuracy.calibration = 'post_conformal'", ["accuracy", "real-world accuracy"]),
        ("Mid-Autumn range", "replenishment_recommendations_current.category = 'Mooncake' OR replenishment_recommendations_current.sku_id IN ('SKU-TE03', 'SKU-GB01')", ["mooncakes", "Mid-Autumn products"]),
        ("Lines to order", "replenishment_recommendations_current.recommended_units > 0", ["orders to place"]),
        ("Manager overrides", "order_decisions_history.decision_status IN ('ADJUSTED', 'REJECTED')", ["overrides", "overridden"]),
        (
            "Last 52 weeks",
            f"channel_weekly_kpis.week_start > DATE_SUB((SELECT MAX(k.week_start) FROM {K} k), 364)",
            ["last year", "past year", "trailing 12 months"],
        ),
    ],
    "expressions": [
        ("override_units", "Units changed by manager", "order_decisions_history.final_order_units - order_decisions_history.recommended_units"),
    ],
}

# Each example teaches one query shape; none repeats a benchmark question.
EXAMPLES = [
    (
        "How have weekly net sales trended by channel over the last 12 weeks?",
        f"""SELECT k.week_start, k.channel_type, SUM(k.net_sales) AS net_sales
FROM {K} k
WHERE k.week_start > DATE_SUB((SELECT MAX(x.week_start) FROM {K} x), 84)
GROUP BY k.week_start, k.channel_type
ORDER BY k.week_start, k.channel_type""",
        "Time-series trend; relative window from the latest week in the data.",
    ),
    (
        "Which airport stores have the most pastry sales at risk if we don't order?",
        f"""SELECT r.location_name, r.region, COUNT(*) AS high_risk_skus,
       SUM(r.est_lost_sales_if_no_order) AS sales_at_risk_usd,
       SUM(r.recommended_units) AS recommended_units
FROM {R} r
WHERE r.channel_type = 'AIRPORT' AND r.category = 'Pastry' AND r.stockout_risk = 'HIGH'
GROUP BY r.location_name, r.region
ORDER BY sales_at_risk_usd DESC
LIMIT 10""",
        "Ranking stores by sales at risk for a channel and category.",
    ),
    (
        "How does forecast error change with how many weeks ahead we forecast, model vs last year?",
        f"""SELECT a.fold, CAST(a.segment AS INT) AS weeks_ahead,
       MAX(CASE WHEN a.method = 'model' THEN a.wmape END) AS model_wmape,
       MAX(CASE WHEN a.method = 'seasonal_naive' THEN a.wmape END) AS last_year_wmape
FROM {A} a
WHERE a.segment_type = 'HORIZON' AND a.scored_against = 'observed_uncensored' AND a.calibration = 'post_conformal'
GROUP BY a.fold, CAST(a.segment AS INT)
ORDER BY a.fold, weeks_ahead""",
        "Pivot model vs baseline accuracy; default to observed_uncensored.",
    ),
    (
        "What is the weekly forecast for Pineapple Cake Box (10pc) in the North region compared with last year?",
        f"""SELECT f.forecast_week, SUM(f.forecast_units) AS expected_units,
       SUM(f.forecast_p90) AS p90_units, SUM(f.baseline_seasonal_naive) AS last_year_units
FROM {F} f
JOIN {L} l ON f.location_id = l.location_id
JOIN {P} p ON f.sku_id = p.sku_id
WHERE p.sku_name = 'Pineapple Cake Box (10pc)' AND l.region = 'North'
GROUP BY f.forecast_week
ORDER BY f.forecast_week""",
        "Forecast joined to store and product dimensions.",
    ),
    (
        "How many recommendations has each region accepted, adjusted, or left pending?",
        f"""SELECT r.region, COALESCE(d.decision_status, 'PENDING') AS decision_status, COUNT(*) AS lines
FROM {R} r
LEFT JOIN {D} d ON r.recommendation_id = d.recommendation_id
WHERE r.recommended_units > 0
GROUP BY r.region, COALESCE(d.decision_status, 'PENDING')
ORDER BY r.region, decision_status""",
        "Pending = recommendation with no decision row (LEFT JOIN).",
    ),
    (
        "How did waste compare with the previous year by region?",
        f"""WITH bounds AS (SELECT MAX(k.week_start) AS last_week FROM {K} k),
yearly AS (
  SELECT k.region,
         CASE WHEN k.week_start > DATE_SUB(b.last_week, 364) THEN 'last_52_weeks' ELSE 'prior_52_weeks' END AS period,
         SUM(k.waste_value) AS waste_value, SUM(k.net_sales) AS net_sales
  FROM {K} k CROSS JOIN bounds b
  WHERE k.week_start > DATE_SUB(b.last_week, 728)
  GROUP BY ALL
)
SELECT y.region, y.period, y.waste_value AS waste_usd, y.waste_value / y.net_sales AS waste_share_of_sales
FROM yearly y
ORDER BY y.region, y.period""",
        "Year-over-year comparison with a CTE; rates computed from sums.",
    ),
]

TEXT_INSTRUCTIONS = """## PURPOSE
- Users are Eastwind Gourmet merchandising planners, store managers, and the VP Merchandising.

## DISAMBIGUATION
- "Mid-Autumn" products means category Mooncake unless the user names other SKUs; Mid-Autumn Festival 2026 is 2026-09-25.
- For Mid-Autumn 2026 festival-week ratio checks, "festival week" means forecast_week 2026-09-21 and "lead-up week" means forecast_week 2026-09-07 unless the user names a different week.
- "Override" means decision_status ADJUSTED or REJECTED.
- "Accuracy" or "forecast error" means WMAPE (lower is better).
- When no period is given for sales, stockouts, or waste, use the last 52 weeks of data and say so.

## DATA QUALITY NOTES
- In forecast_accuracy, method model_p90_coverage stores p90 coverage in the wmape column; it is not an error.
- Use forecast_accuracy scored_against observed_uncensored unless the user asks about true or simulated demand.
- Weeks with 2+ out-of-stock days are censored: their sales understate demand.

## CONSTRAINTS
- Recommendations are suggestions, not placed orders; committed quantities are final_order_units in order_decisions_history.

## Instructions you must follow when providing summaries
- State the week range or the as-of date used.
- In SQL results, return unrounded values and rates as fractions between 0 and 1.
- In the written summary, show money in USD rounded to whole dollars and rates as percentages with one decimal place.
"""

SAMPLE_QUESTIONS = [
    "Which highway stores face the highest Mid-Autumn stockout risk?",
    "Where did managers override the recommended order?",
    "How accurate is the forecast compared with last year's sales?",
    "What did waste cost us by channel over the last year?",
    "What should we order this week, and what will it cost?",
]

# (question, sql, evaluation_note). Literals come from profiled values; every SQL is run by --check.
BENCHMARKS = [
    (
        "What are the top 10 highway stores by mooncake sales at risk from high stockout risk?",
        f"""SELECT r.location_name, r.region, COUNT(*) AS high_risk_mooncake_skus,
       SUM(r.est_lost_sales_if_no_order) AS sales_at_risk_usd
FROM {R} r
WHERE r.channel_type = 'HIGHWAY' AND r.category = 'Mooncake' AND r.stockout_risk = 'HIGH'
GROUP BY r.location_name, r.region
ORDER BY sales_at_risk_usd DESC
LIMIT 10""",
        "Must filter HIGHWAY, Mooncake, stockout_risk HIGH and rank by sales at risk; Taian Service Area N should be first.",
    ),
    (
        "List each order line a manager overrode, with store, product, decision, recommended and final units, and reason.",
        f"""SELECT r.location_name, r.sku_name, d.decision_status, d.recommended_units, d.final_order_units, d.reason
FROM {D} d
JOIN {R} r ON d.recommendation_id = r.recommendation_id
WHERE d.decision_status IN ('ADJUSTED', 'REJECTED')
ORDER BY r.location_name""",
        "Overrides are ADJUSTED and REJECTED decisions; should list store, SKU, quantities and reason.",
    ),
    (
        "What was waste as a percentage of net sales by channel over the last 52 weeks?",
        f"""SELECT k.channel_type, SUM(k.waste_value) AS waste_usd,
       SUM(k.waste_value) / SUM(k.net_sales) AS waste_share_of_sales
FROM {K} k
WHERE k.week_start > DATE_SUB((SELECT MAX(x.week_start) FROM {K} x), 364)
GROUP BY k.channel_type
ORDER BY waste_usd DESC""",
        "Rate must be SUM(waste)/SUM(sales), not an average of weekly rates.",
    ),
    (
        "Compare the model's WMAPE with the same-week-last-year baseline by channel for the Mid-Autumn 2025 backtest.",
        f"""SELECT a.segment AS channel_type,
       MAX(CASE WHEN a.method = 'model' THEN a.wmape END) AS model_wmape,
       MAX(CASE WHEN a.method = 'seasonal_naive' THEN a.wmape END) AS seasonal_naive_wmape
FROM {A} a
WHERE a.fold = 'MA2025' AND a.segment_type = 'CHANNEL' AND a.scored_against = 'observed_uncensored' AND a.calibration = 'post_conformal'
GROUP BY a.segment
ORDER BY a.segment""",
        "Must use fold MA2025, segment_type CHANNEL, scored_against observed_uncensored.",
    ),
    (
        "How many order lines are recommended and what is the order value at cost by channel?",
        f"""SELECT r.channel_type, COUNT_IF(r.recommended_units > 0) AS lines_to_order,
       SUM(r.recommended_units * r.unit_cost) AS order_value_at_cost_usd
FROM {R} r
GROUP BY r.channel_type
ORDER BY order_value_at_cost_usd DESC""",
        "Lines to order are rows with recommended_units > 0; value = units x unit_cost.",
    ),
    (
        "What is total expected mooncake demand for each forecast week?",
        f"""SELECT f.forecast_week, SUM(f.forecast_units) AS expected_units
FROM {F} f
JOIN {P} p ON f.sku_id = p.sku_id
WHERE p.category = 'Mooncake'
GROUP BY f.forecast_week
ORDER BY f.forecast_week""",
        "Six forecast weeks from 2026-08-31; expected units sum forecast_units.",
    ),
    (
        "Which region had the highest stockout day rate over the last 4 weeks?",
        f"""SELECT k.region,
       SUM(k.stockout_day_rate * k.ranged_series) / SUM(k.ranged_series) AS stockout_day_rate
FROM {K} k
WHERE k.week_start > DATE_SUB((SELECT MAX(x.week_start) FROM {K} x), 28)
GROUP BY k.region
ORDER BY stockout_day_rate DESC
LIMIT 1""",
        "Rate must be weighted by ranged_series across channels and weeks.",
    ),
    (
        "How many store-SKUs are at high overstock risk and how much stock value is expected to expire?",
        f"""SELECT COUNT(*) AS high_overstock_store_skus, SUM(r.est_expiry_value) AS expected_expiry_value_usd
FROM {R} r
WHERE r.overstock_risk = 'HIGH'""",
        None,
    ),
    (
        "Which products had their recommended order capped by shelf life most often?",
        f"""SELECT r.sku_name, COUNT(*) AS shelf_capped_stores
FROM {R} r
WHERE r.cap_applied = 'SHELF_LIFE'
GROUP BY r.sku_name
ORDER BY shelf_capped_stores DESC""",
        None,
    ),
    (
        "What share of actual demand fell at or below the model's p90 in each backtest?",
        f"""SELECT a.fold, a.wmape AS p90_coverage
FROM {A} a
WHERE a.method = 'model_p90_coverage' AND a.segment_type = 'ALL' AND a.scored_against = 'observed_uncensored'
  AND a.calibration = 'post_conformal'
ORDER BY a.fold""",
        "p90 coverage is stored in the wmape column for method model_p90_coverage; target is 0.90.",
    ),
    (
        "What was the peak gift stockout day rate by channel during the Mid-Autumn 2025 window?",
        f"""SELECT k.channel_type,
       SUM(k.peak_gift_stockout_day_rate * k.peak_gift_ranged_series) / SUM(k.peak_gift_ranged_series) AS peak_gift_stockout_day_rate
FROM {K} k
WHERE k.week_start BETWEEN DATE'2025-09-15' AND DATE'2025-10-07'
GROUP BY k.channel_type
ORDER BY peak_gift_stockout_day_rate DESC""",
        "Must use peak_gift_stockout_day_rate, not overall stockout_day_rate, and filter the Mid-Autumn 2025 event window.",
    ),
    (
        "How much annualized lost sales and waste reduction does the forecast policy show by channel?",
        f"""SELECT b.channel_type,
       SUM(b.lost_sales_delta) AS raw_lost_sales_reduction_usd,
       SUM(b.waste_delta) AS raw_waste_reduction_usd,
       SUM(b.lost_sales_delta) * 52 / SUM(b.window_weeks) AS pooled_annualized_lost_sales_reduction_usd,
       SUM(b.waste_delta) * 52 / SUM(b.window_weeks) AS pooled_annualized_waste_reduction_usd
FROM {C}.gold.business_impact_summary b
GROUP BY b.channel_type
ORDER BY pooled_annualized_lost_sales_reduction_usd DESC""",
        "Must use raw deltas and pooled annualization; do not sum per-fold annualized values.",
    ),
    (
        "For current Mid-Autumn peak SKUs, what is the festival-week forecast ratio versus the 2026-09-07 lead-up week?",
        f"""SELECT f.sku_id,
       SUM(CASE WHEN f.forecast_week = DATE'2026-09-21' THEN f.forecast_units ELSE 0 END) AS festival_week_units,
       SUM(CASE WHEN f.forecast_week = DATE'2026-09-07' THEN f.forecast_units ELSE 0 END) AS leadup_week_units,
       SUM(CASE WHEN f.forecast_week = DATE'2026-09-21' THEN f.forecast_units ELSE 0 END)
         / NULLIF(SUM(CASE WHEN f.forecast_week = DATE'2026-09-07' THEN f.forecast_units ELSE 0 END), 0) AS festival_to_leadup_ratio
FROM {F} f
JOIN {P} p ON f.sku_id = p.sku_id
WHERE p.peak_gift_flag = true AND f.sku_id IN ('SKU-MC01', 'SKU-MC02', 'SKU-MC03', 'SKU-MC04', 'SKU-GB01', 'SKU-TE03')
GROUP BY f.sku_id
ORDER BY festival_to_leadup_ratio DESC""",
        "Must compare festival week 2026-09-21 against lead-up week 2026-09-07 for current forecasts and include TE03/GB01 peak gifts.",
    ),
    (
        "Show raw in-window policy lost sales and waste by fold and channel.",
        f"""SELECT b.fold, b.channel_type, b.window_weeks,
       b.forecast_lost_sales, b.manual_lost_sales, b.lost_sales_delta,
       b.forecast_waste_value, b.manual_waste_value, b.waste_delta
FROM {C}.gold.business_impact_summary b
ORDER BY b.fold, b.channel_type""",
        "Must report raw in-window dollars by fold/channel rather than summing annualized rates.",
    ),
    (
        "Show total expected demand by forecast week for current forecasts only.",
        f"""SELECT f.forecast_week, SUM(f.forecast_units) AS expected_units
FROM {F} f
GROUP BY f.forecast_week
ORDER BY f.forecast_week""",
        "Must query demand_forecasts_current so old appended forecast runs are not double-counted.",
    ),
    (
        "Which 5 downtown stores have the largest recommended order value at cost?",
        f"""SELECT r.location_name, SUM(r.recommended_units * r.unit_cost) AS order_value_at_cost_usd
FROM {R} r
WHERE r.channel_type = 'DOWNTOWN'
GROUP BY r.location_name
ORDER BY order_value_at_cost_usd DESC
LIMIT 5""",
        None,
    ),
]


def build() -> dict:
    tables = []
    for ident in sorted(TABLES):
        t = TABLES[ident]
        tables.append(
            {
                "identifier": ident,
                "description": [t["description"]],
                "column_configs": sorted(t["columns"], key=lambda c: c["column_name"]),
            }
        )

    join_specs = [
        {
            "id": iid(f"join:{la}:{ra}:{cond}"),
            "left": {"identifier": l, "alias": la},
            "right": {"identifier": r, "alias": ra},
            "sql": [cond, f"--rt=FROM_RELATIONSHIP_TYPE_{rt}--"],
        }
        for l, la, r, ra, cond, rt in JOINS
    ]
    snippets = {
        "measures": [
            {"id": iid(f"measure:{a}"), "alias": a, "display_name": dn, "sql": [s], "synonyms": syn}
            for a, dn, s, syn in SNIPPETS["measures"]
        ],
        "filters": [
            {"id": iid(f"filter:{dn}"), "display_name": dn, "sql": [s], "synonyms": syn}
            for dn, s, syn in SNIPPETS["filters"]
        ],
        "expressions": [
            {"id": iid(f"expr:{a}"), "alias": a, "display_name": dn, "sql": [s]} for a, dn, s in SNIPPETS["expressions"]
        ],
    }
    benchmarks = []
    for q, s, note in BENCHMARKS:
        b = {"id": iid(f"bench:{q}"), "question": [q], "answer": [{"format": "SQL", "content": [s]}]}
        if note:
            b["evaluation_note"] = [note]
        benchmarks.append(b)

    return {
        "version": 2,
        "config": {
            "sample_questions": sorted(
                [{"id": iid(f"sample:{q}"), "question": [q]} for q in SAMPLE_QUESTIONS], key=lambda x: x["id"]
            )
        },
        "data_sources": {"tables": tables},
        "instructions": {
            "text_instructions": [{"id": iid("text:main"), "content": [TEXT_INSTRUCTIONS]}],
            "example_question_sqls": sorted(
                [
                    {"id": iid(f"example:{q}"), "question": [q], "sql": [s], "usage_guidance": [g]}
                    for q, s, g in EXAMPLES
                ],
                key=lambda x: x["id"],
            ),
            "join_specs": sorted(join_specs, key=lambda x: x["id"]),
            "sql_snippets": {k: sorted(v, key=lambda x: x["id"]) for k, v in snippets.items()},
        },
        "benchmarks": {"questions": sorted(benchmarks, key=lambda x: x["id"])},
    }


def cli(*args: str) -> str:
    out = subprocess.run(["databricks", *args, "--profile", PROFILE, "-o", "json"], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"databricks {' '.join(args[:3])} failed:\n{out.stderr}")
    return out.stdout


def check() -> bool:
    """Run every example and benchmark SQL; fail on errors or empty results."""
    ok = True
    items = [("example", q, s) for q, s, _ in EXAMPLES] + [("benchmark", q, s) for q, s, _ in BENCHMARKS]
    for kind, q, s in items:
        out = subprocess.run(
            ["databricks", "experimental", "aitools", "tools", "query", "--profile", PROFILE,
             "--warehouse", WAREHOUSE_ID, "-o", "json", s],
            capture_output=True, text=True,
        )
        rows = json.loads(out.stdout) if out.returncode == 0 and out.stdout.strip().startswith("[") else None
        status = "OK" if rows else ("EMPTY" if rows == [] else "ERROR")
        ok &= status == "OK"
        print(f"{status:5} {kind:9} rows={len(rows) if rows else 0:3}  {q}")
        if status == "ERROR":
            print("      " + (out.stderr or out.stdout).strip().splitlines()[-1])
    return ok


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--deploy", action="store_true")
    a = ap.parse_args()

    space = build()
    (HERE / "serialized_space.json").write_text(json.dumps(space, indent=2) + "\n")
    print(f"Wrote genie/serialized_space.json: {len(space['data_sources']['tables'])} tables, "
          f"{len(EXAMPLES)} examples, {len(BENCHMARKS)} benchmarks")

    if a.check and not check():
        sys.exit("SQL check failed")

    if a.deploy:
        id_file = HERE / "space_id.txt"
        body = {"serialized_space": json.dumps(space), "title": TITLE, "description": DESCRIPTION,
                "warehouse_id": WAREHOUSE_ID}
        if id_file.exists():
            space_id = id_file.read_text().strip()
            cli("genie", "update-space", space_id, "--json", json.dumps(body))
            print(f"Updated Genie space {space_id}")
        else:
            subprocess.run(["databricks", "workspace", "mkdirs", PARENT_PATH, "--profile", PROFILE], check=True)
            res = json.loads(cli("genie", "create-space", "--json", json.dumps({**body, "parent_path": PARENT_PATH})))
            space_id = res["space_id"]
            id_file.write_text(space_id + "\n")
            print(f"Created Genie space {space_id}")


if __name__ == "__main__":
    main()
