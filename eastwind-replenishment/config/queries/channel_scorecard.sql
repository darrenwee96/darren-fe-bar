-- Channel scorecard: last 13 weeks vs the same weeks a year earlier.
WITH bounds AS (SELECT max(week_start) AS last_week FROM darren_fe_bar_catalog.gold.channel_weekly_kpis),
tagged AS (
  SELECT
    CASE WHEN k.week_start > date_sub(b.last_week, 91) THEN 'cy'
         WHEN k.week_start > date_sub(b.last_week, 455) AND k.week_start <= date_sub(b.last_week, 364) THEN 'py' END AS period,
    k.*
  FROM darren_fe_bar_catalog.gold.channel_weekly_kpis k CROSS JOIN bounds b
)
SELECT
  channel_type AS channel,
  CAST(sum(CASE WHEN period = 'cy' THEN net_sales END) AS DOUBLE) AS net_sales,
  CAST(sum(CASE WHEN period = 'py' THEN net_sales END) AS DOUBLE) AS net_sales_py,
  CAST(sum(CASE WHEN period = 'cy' THEN stockout_day_rate * ranged_series END)
       / sum(CASE WHEN period = 'cy' THEN ranged_series END) AS DOUBLE) AS stockout_rate,
  CAST(sum(CASE WHEN period = 'py' THEN stockout_day_rate * ranged_series END)
       / sum(CASE WHEN period = 'py' THEN ranged_series END) AS DOUBLE) AS stockout_rate_py,
  CAST(sum(CASE WHEN period = 'cy' THEN waste_value END) / sum(CASE WHEN period = 'cy' THEN net_sales END) AS DOUBLE) AS waste_rate,
  CAST(sum(CASE WHEN period = 'cy' THEN censored_series_share * ranged_series END)
       / sum(CASE WHEN period = 'cy' THEN ranged_series END) AS DOUBLE) AS censored_share
FROM tagged
WHERE period IS NOT NULL
GROUP BY channel_type
ORDER BY net_sales DESC
