-- @param location_id STRING = L0001
-- @param sku_id STRING = SKU-MC01
-- Weekly units for one store-SKU: 26 weeks actual, the 6-week forecast, and the same week last year.
-- The forecast column repeats the last actual week so the two lines join.
WITH run AS (SELECT max(as_of_date) AS as_of FROM darren_fe_bar_catalog.gold.demand_forecasts),
hist AS (
  SELECT week_start, units_sold, coalesce(units_lag_52, 0) AS last_year
  FROM darren_fe_bar_catalog.gold.weekly_demand_features
  WHERE location_id = :location_id AND sku_id = :sku_id
  ORDER BY week_start DESC
  LIMIT 26
),
fc AS (
  SELECT f.forecast_week, f.forecast_units, f.baseline_seasonal_naive
  FROM darren_fe_bar_catalog.gold.demand_forecasts f JOIN run ON f.as_of_date = run.as_of
  WHERE f.location_id = :location_id AND f.sku_id = :sku_id
),
last_actual AS (SELECT max(week_start) AS week_start FROM hist)
SELECT date_format(h.week_start, 'd MMM') AS week, CAST(h.units_sold AS DOUBLE) AS actual,
       CAST(CASE WHEN h.week_start = la.week_start THEN h.units_sold END AS DOUBLE) AS forecast,
       CAST(h.last_year AS DOUBLE) AS last_year, CAST(h.week_start AS STRING) AS week_start
FROM hist h CROSS JOIN last_actual la
UNION ALL
SELECT date_format(forecast_week, 'd MMM'), CAST(NULL AS DOUBLE), CAST(round(forecast_units, 1) AS DOUBLE),
       CAST(baseline_seasonal_naive AS DOUBLE), CAST(forecast_week AS STRING)
FROM fc
ORDER BY week_start
