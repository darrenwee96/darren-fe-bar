-- Backtest WMAPE by channel, averaged over the Mid-Autumn 2025 and Lunar New Year 2026 folds.
SELECT
  segment AS channel,
  CAST(round(avg(CASE WHEN method = 'model' THEN wmape END) * 100, 1) AS DOUBLE) AS model,
  CAST(round(avg(CASE WHEN method = 'seasonal_naive' THEN wmape END) * 100, 1) AS DOUBLE) AS same_week_last_year
FROM darren_fe_bar_catalog.gold.forecast_accuracy
WHERE scored_against = 'observed_uncensored' AND segment_type = 'CHANNEL'
GROUP BY segment
ORDER BY segment
