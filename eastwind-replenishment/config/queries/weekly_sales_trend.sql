-- Weekly net sales for the last 52 weeks (actual) vs the same week a year earlier, USD thousands.
WITH k AS (SELECT week_start, sum(net_sales) AS net_sales FROM darren_fe_bar_catalog.gold.channel_weekly_kpis GROUP BY week_start),
b AS (SELECT max(week_start) AS last_week FROM k)
SELECT
  date_format(c.week_start, 'd MMM') AS week,
  CAST(round(c.net_sales / 1000, 1) AS DOUBLE) AS actual,
  CAST(round(p.net_sales / 1000, 1) AS DOUBLE) AS last_year
FROM k c CROSS JOIN b
LEFT JOIN k p ON p.week_start = date_sub(c.week_start, 364)
WHERE c.week_start > date_sub(b.last_week, 364)
ORDER BY c.week_start
