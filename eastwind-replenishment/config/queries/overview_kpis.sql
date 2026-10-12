-- Headline KPIs: the last 13 weeks vs the same 13 weeks a year earlier, backtest accuracy, and the forecast as-of date.
WITH bounds AS (SELECT max(week_start) AS last_week FROM darren_fe_bar_catalog.gold.channel_weekly_kpis),
tagged AS (
  SELECT
    CASE WHEN k.week_start > date_sub(b.last_week, 91) THEN 'cy'
         WHEN k.week_start > date_sub(b.last_week, 455) AND k.week_start <= date_sub(b.last_week, 364) THEN 'py' END AS period,
    k.*
  FROM darren_fe_bar_catalog.gold.channel_weekly_kpis k CROSS JOIN bounds b
),
agg AS (
  SELECT period, min(week_start) AS period_start, max(week_start) AS period_end, sum(net_sales) AS net_sales,
         sum(waste_value) AS waste_value, sum(stockout_day_rate * ranged_series) / sum(ranged_series) AS stockout_rate
  FROM tagged WHERE period IS NOT NULL GROUP BY period
),
accuracy AS (
  SELECT avg(CASE WHEN method = 'model' THEN wmape END) AS model_wmape,
         avg(CASE WHEN method = 'seasonal_naive' THEN wmape END) AS baseline_wmape,
         max(model_version) AS model_version
  FROM darren_fe_bar_catalog.gold.forecast_accuracy
  WHERE scored_against = 'observed_uncensored' AND segment_type = 'ALL'
)
SELECT
  CAST(cy.period_start AS STRING) AS period_start,
  CAST(cy.period_end AS STRING) AS period_end,
  CAST(cy.net_sales AS DOUBLE) AS net_sales,
  CAST(py.net_sales AS DOUBLE) AS net_sales_py,
  CAST(cy.stockout_rate AS DOUBLE) AS stockout_rate,
  CAST(py.stockout_rate AS DOUBLE) AS stockout_rate_py,
  CAST(cy.waste_value AS DOUBLE) AS waste_value,
  CAST(py.waste_value AS DOUBLE) AS waste_value_py,
  CAST(cy.waste_value / cy.net_sales AS DOUBLE) AS waste_rate,
  CAST(py.waste_value / py.net_sales AS DOUBLE) AS waste_rate_py,
  CAST(a.model_wmape AS DOUBLE) AS model_wmape,
  CAST(a.baseline_wmape AS DOUBLE) AS baseline_wmape,
  a.model_version,
  (SELECT CAST(max(as_of_date) AS STRING) FROM darren_fe_bar_catalog.gold.demand_forecasts) AS forecast_as_of
FROM agg cy JOIN agg py ON cy.period = 'cy' AND py.period = 'py' CROSS JOIN accuracy a
