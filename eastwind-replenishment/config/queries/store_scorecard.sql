-- @param channel STRING = ALL
-- @param region STRING = ALL
-- One row per store: last 13 weeks sales vs a year earlier, stockout-day rate and waste, plus current order risk.
WITH b AS (SELECT max(week_start) AS last_week FROM darren_fe_bar_catalog.gold.weekly_demand_features),
w AS (
  SELECT
    f.location_id,
    max(f.channel_type) AS channel_type,
    max(f.region) AS region,
    max(f.capacity_tier) AS capacity_tier,
    sum(CASE WHEN f.week_start > date_sub(b.last_week, 91) THEN f.net_sales END) AS net_sales,
    sum(CASE WHEN f.week_start > date_sub(b.last_week, 455) AND f.week_start <= date_sub(b.last_week, 364) THEN f.net_sales END) AS net_sales_py,
    sum(CASE WHEN f.week_start > date_sub(b.last_week, 91) THEN f.oos_days END)
      / (count_if(f.week_start > date_sub(b.last_week, 91)) * 7) AS stockout_rate,
    sum(CASE WHEN f.week_start > date_sub(b.last_week, 91) THEN f.expired_value + f.markdown_value END) AS waste_value
  FROM darren_fe_bar_catalog.gold.weekly_demand_features f CROSS JOIN b
  WHERE f.week_start > date_sub(b.last_week, 455)
  GROUP BY f.location_id
),
r AS (
  SELECT
    location_id,
    max(location_name) AS location_name,
    count_if(stockout_risk = 'HIGH') AS high_risk_skus,
    sum(CASE WHEN stockout_risk = 'HIGH' THEN est_lost_sales_if_no_order ELSE 0 END) AS sales_at_risk,
    count_if(recommended_units > 0) AS lines_to_order
  FROM darren_fe_bar_catalog.gold.replenishment_recommendations_current
  GROUP BY location_id
)
SELECT
  w.location_id,
  r.location_name,
  w.channel_type AS channel,
  w.region,
  w.capacity_tier AS size,
  CAST(w.net_sales AS DOUBLE) AS net_sales,
  CAST((w.net_sales - w.net_sales_py) / w.net_sales_py AS DOUBLE) AS sales_vs_py,
  CAST(w.stockout_rate AS DOUBLE) AS stockout_rate,
  CAST(w.waste_value / w.net_sales AS DOUBLE) AS waste_rate,
  CAST(r.high_risk_skus AS DOUBLE) AS high_risk_skus,
  CAST(r.sales_at_risk AS DOUBLE) AS sales_at_risk,
  CAST(r.lines_to_order AS DOUBLE) AS lines_to_order
FROM w JOIN r USING (location_id)
WHERE (:channel = 'ALL' OR w.channel_type = :channel)
  AND (:region = 'ALL' OR w.region = :region)
ORDER BY sales_at_risk DESC, r.location_name
