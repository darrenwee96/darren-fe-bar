-- @param fold STRING = MA2025
-- Backtest accuracy by segment for one fold: WMAPE for model and baselines, model bias, and p90 coverage.
SELECT
  CASE segment_type WHEN 'ALL' THEN 'All stores' WHEN 'SEGMENT' THEN 'Peak gifts, holiday weeks' ELSE initcap(segment) END AS segment,
  CAST(max(CASE WHEN method = 'model' THEN wmape END) AS DOUBLE) AS model_wmape,
  CAST(max(CASE WHEN method = 'seasonal_naive' THEN wmape END) AS DOUBLE) AS same_week_ly_wmape,
  CAST(max(CASE WHEN method = 'event_naive' THEN wmape END) AS DOUBLE) AS same_holiday_ly_wmape,
  CAST(max(CASE WHEN method = 'model' THEN bias END) AS DOUBLE) AS model_bias,
  CAST(max(CASE WHEN method = 'model_p90_coverage' THEN wmape END) AS DOUBLE) AS p90_coverage
FROM darren_fe_bar_catalog.gold.forecast_accuracy
WHERE scored_against = 'observed_uncensored' AND fold = :fold AND segment_type IN ('ALL', 'CHANNEL', 'SEGMENT')
GROUP BY segment_type, segment
ORDER BY CASE segment_type WHEN 'ALL' THEN 0 WHEN 'CHANNEL' THEN 1 ELSE 2 END, segment
