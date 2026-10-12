-- Backtest WMAPE (%) from the latest backtest run, averaged over the Mid-Autumn 2025 and Lunar New Year 2026 folds:
-- all stores, each channel, and peak gift SKUs in holiday weeks. Model vs same week last year, observed uncensored weeks.
WITH run AS (
  SELECT backtest_run_id
  FROM darren_fe_bar_catalog.gold.forecast_accuracy
  GROUP BY backtest_run_id
  ORDER BY max(generated_at) DESC
  LIMIT 1
)
SELECT
  CASE segment_type WHEN 'ALL' THEN 'ALL' WHEN 'SEGMENT' THEN 'PEAK_GIFT' ELSE segment END AS segment,
  CAST(round(avg(CASE WHEN method = 'model' THEN wmape END) * 100, 1) AS DOUBLE) AS model,
  CAST(round(avg(CASE WHEN method = 'seasonal_naive' THEN wmape END) * 100, 1) AS DOUBLE) AS same_week_last_year,
  max(model_version) AS model_version
FROM darren_fe_bar_catalog.gold.forecast_accuracy
JOIN run USING (backtest_run_id)
WHERE scored_against = 'observed_uncensored' AND segment_type IN ('ALL', 'CHANNEL', 'SEGMENT')
GROUP BY segment_type, segment
ORDER BY CASE segment_type WHEN 'ALL' THEN 0 WHEN 'CHANNEL' THEN 1 ELSE 2 END, segment
