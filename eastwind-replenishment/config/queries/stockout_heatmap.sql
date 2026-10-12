-- Stockout-day rate (%) by region and channel over the last 13 weeks.
SELECT
  channel_type AS channel,
  region,
  CAST(round(sum(stockout_day_rate * ranged_series) / sum(ranged_series) * 100, 1) AS DOUBLE) AS stockout_rate_pct
FROM darren_fe_bar_catalog.gold.channel_weekly_kpis
WHERE week_start > date_sub((SELECT max(week_start) FROM darren_fe_bar_catalog.gold.channel_weekly_kpis), 91)
GROUP BY channel_type, region
ORDER BY region, channel_type
