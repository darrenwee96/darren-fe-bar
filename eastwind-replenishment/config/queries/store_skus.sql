-- @param location_id STRING = L0001
-- Current stock position and order recommendation for every SKU in one store.
SELECT
  recommendation_id,
  sku_name,
  category,
  CAST(on_hand_units AS DOUBLE) AS on_hand,
  CAST(inbound_units AS DOUBLE) AS inbound,
  CAST(recent_weekly_units AS DOUBLE) AS weekly_sales,
  CAST(round((on_hand_units + inbound_units) / nullif(demand_6w_units / 6, 0), 1) AS DOUBLE) AS weeks_of_cover,
  stockout_risk,
  overstock_risk,
  CAST(recommended_units AS DOUBLE) AS recommended_units,
  CAST(est_lost_sales_if_no_order AS DOUBLE) AS sales_at_risk
FROM darren_fe_bar_catalog.gold.replenishment_recommendations_current
WHERE location_id = :location_id
ORDER BY CASE stockout_risk WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, est_lost_sales_if_no_order DESC, sku_name
