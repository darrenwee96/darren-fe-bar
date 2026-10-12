-- @param region STRING = ALL
-- @param channel STRING = ALL
-- @param category STRING = ALL
-- @param location_id STRING = ALL
-- Waste (expired + markdown value) and net sales for the filtered scope: last 13 weeks vs the same 13 weeks a year earlier.
WITH b AS (SELECT max(week_start) AS last_week FROM darren_fe_bar_catalog.gold.weekly_demand_features),
tagged AS (
  SELECT
    CASE WHEN w.week_start > date_sub(b.last_week, 91) THEN 'cy'
         WHEN w.week_start > date_sub(b.last_week, 455) AND w.week_start <= date_sub(b.last_week, 364) THEN 'py' END AS period,
    w.week_start, w.net_sales, w.expired_value, w.markdown_value
  FROM darren_fe_bar_catalog.gold.weekly_demand_features w CROSS JOIN b
  WHERE (:region = 'ALL' OR w.region = :region)
    AND (:channel = 'ALL' OR w.channel_type = :channel)
    AND (:category = 'ALL' OR w.category = :category)
    AND (:location_id = 'ALL' OR w.location_id = :location_id)
)
SELECT
  CAST(min(CASE WHEN period = 'cy' THEN week_start END) AS STRING) AS period_start,
  CAST(max(CASE WHEN period = 'cy' THEN week_start END) AS STRING) AS period_end,
  CAST(sum(CASE WHEN period = 'cy' THEN expired_value + markdown_value END) AS DOUBLE) AS waste_value,
  CAST(sum(CASE WHEN period = 'py' THEN expired_value + markdown_value END) AS DOUBLE) AS waste_value_py,
  CAST(sum(CASE WHEN period = 'cy' THEN markdown_value END) AS DOUBLE) AS markdown_value,
  CAST(sum(CASE WHEN period = 'cy' THEN net_sales END) AS DOUBLE) AS net_sales,
  CAST(sum(CASE WHEN period = 'py' THEN net_sales END) AS DOUBLE) AS net_sales_py
FROM tagged
WHERE period IS NOT NULL
