-- @param fold STRING = MA2025
-- Backtest WMAPE (%) by weeks ahead: model vs the two last-year baselines, scored on observed uncensored weeks.
SELECT
  concat(segment, ' wk') AS weeks_ahead,
  CAST(round(max(CASE WHEN method = 'model' THEN wmape END) * 100, 1) AS DOUBLE) AS model,
  CAST(round(max(CASE WHEN method = 'seasonal_naive' THEN wmape END) * 100, 1) AS DOUBLE) AS same_week_last_year,
  CAST(round(max(CASE WHEN method = 'event_naive' THEN wmape END) * 100, 1) AS DOUBLE) AS same_holiday_last_year
FROM darren_fe_bar_catalog.gold.forecast_accuracy
WHERE scored_against = 'observed_uncensored' AND segment_type = 'HORIZON' AND fold = :fold
GROUP BY segment
ORDER BY CAST(segment AS INT)
