-- @param channel STRING = ALL
-- Next 6 weeks: expected units by category vs the same weeks last year.
WITH sku AS (SELECT DISTINCT sku_id, category FROM darren_fe_bar_catalog.gold.weekly_demand_features),
run AS (SELECT max(as_of_date) AS as_of FROM darren_fe_bar_catalog.gold.demand_forecasts)
SELECT
  sku.category,
  CAST(round(sum(f.forecast_units)) AS DOUBLE) AS expected_units,
  CAST(sum(f.baseline_seasonal_naive) AS DOUBLE) AS last_year_units,
  CAST((sum(f.forecast_units) - sum(f.baseline_seasonal_naive)) / nullif(sum(f.baseline_seasonal_naive), 0) AS DOUBLE) AS change_vs_ly
FROM darren_fe_bar_catalog.gold.demand_forecasts f
JOIN run ON f.as_of_date = run.as_of
JOIN sku ON f.sku_id = sku.sku_id
WHERE (:channel = 'ALL' OR f.channel_type = :channel)
GROUP BY sku.category
ORDER BY expected_units DESC
