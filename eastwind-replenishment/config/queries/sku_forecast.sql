-- @param location_id STRING = L0001
-- @param sku_id STRING = SKU-MC01
-- Six-week forecast for one store-SKU from the latest run: expected units, p90, and last year.
WITH run AS (
  SELECT forecast_run_id FROM darren_fe_bar_catalog.gold.demand_forecasts ORDER BY generated_at DESC LIMIT 1
)
SELECT
  CAST(f.forecast_week AS STRING) AS week,
  f.horizon,
  CAST(round(f.forecast_units, 1) AS DOUBLE) AS expected,
  CAST(round(f.forecast_p90, 1) AS DOUBLE) AS p90,
  CAST(f.baseline_seasonal_naive AS DOUBLE) AS last_year
FROM darren_fe_bar_catalog.gold.demand_forecasts f
JOIN run USING (forecast_run_id)
WHERE f.location_id = :location_id AND f.sku_id = :sku_id
ORDER BY f.forecast_week
