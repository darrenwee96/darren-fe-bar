-- @param channel STRING = ALL
-- @param category STRING = ALL
-- Network weekly units: 26 weeks actual, the 6-week forecast, and the same week last year.
-- The forecast column repeats the last actual week so the two lines join.
WITH sku AS (SELECT DISTINCT sku_id, category FROM darren_fe_bar_catalog.gold.weekly_demand_features),
run AS (SELECT max(as_of_date) AS as_of FROM darren_fe_bar_catalog.gold.demand_forecasts),
b AS (SELECT max(week_start) AS last_week FROM darren_fe_bar_catalog.gold.weekly_demand_features),
hist AS (
  SELECT w.week_start, sum(w.units_sold) AS units, sum(coalesce(w.units_lag_52, 0)) AS last_year
  FROM darren_fe_bar_catalog.gold.weekly_demand_features w CROSS JOIN b
  WHERE w.week_start > date_sub(b.last_week, 182)
    AND (:channel = 'ALL' OR w.channel_type = :channel)
    AND (:category = 'ALL' OR w.category = :category)
  GROUP BY w.week_start
),
fc AS (
  SELECT f.forecast_week AS week_start, sum(f.forecast_units) AS units, sum(f.baseline_seasonal_naive) AS last_year
  FROM darren_fe_bar_catalog.gold.demand_forecasts f
  JOIN run ON f.as_of_date = run.as_of
  JOIN sku ON f.sku_id = sku.sku_id
  WHERE (:channel = 'ALL' OR f.channel_type = :channel)
    AND (:category = 'ALL' OR sku.category = :category)
  GROUP BY f.forecast_week
)
SELECT date_format(h.week_start, 'd MMM') AS week, CAST(h.units AS DOUBLE) AS actual,
       CAST(CASE WHEN h.week_start = b.last_week THEN h.units END AS DOUBLE) AS forecast,
       CAST(h.last_year AS DOUBLE) AS last_year, CAST(h.week_start AS STRING) AS week_start
FROM hist h CROSS JOIN b
UNION ALL
SELECT date_format(week_start, 'd MMM'), CAST(NULL AS DOUBLE), CAST(round(units) AS DOUBLE), CAST(last_year AS DOUBLE), CAST(week_start AS STRING)
FROM fc
ORDER BY week_start
