-- Weekly stockout-day rate (%) and waste (USD thousands) by channel over the last 52 weeks.
SELECT
  date_format(week_start, 'd MMM') AS week,
  CAST(round(sum(CASE WHEN channel_type = 'DOWNTOWN' THEN stockout_day_rate * ranged_series END)
       / sum(CASE WHEN channel_type = 'DOWNTOWN' THEN ranged_series END) * 100, 1) AS DOUBLE) AS downtown_stockout,
  CAST(round(sum(CASE WHEN channel_type = 'HIGHWAY' THEN stockout_day_rate * ranged_series END)
       / sum(CASE WHEN channel_type = 'HIGHWAY' THEN ranged_series END) * 100, 1) AS DOUBLE) AS highway_stockout,
  CAST(round(sum(CASE WHEN channel_type = 'AIRPORT' THEN stockout_day_rate * ranged_series END)
       / sum(CASE WHEN channel_type = 'AIRPORT' THEN ranged_series END) * 100, 1) AS DOUBLE) AS airport_stockout,
  CAST(round(sum(CASE WHEN channel_type = 'DOWNTOWN' THEN waste_value END) / 1000, 1) AS DOUBLE) AS downtown_waste,
  CAST(round(sum(CASE WHEN channel_type = 'HIGHWAY' THEN waste_value END) / 1000, 1) AS DOUBLE) AS highway_waste,
  CAST(round(sum(CASE WHEN channel_type = 'AIRPORT' THEN waste_value END) / 1000, 1) AS DOUBLE) AS airport_waste
FROM darren_fe_bar_catalog.gold.channel_weekly_kpis
WHERE week_start > date_sub((SELECT max(week_start) FROM darren_fe_bar_catalog.gold.channel_weekly_kpis), 364)
GROUP BY week_start
ORDER BY week_start
