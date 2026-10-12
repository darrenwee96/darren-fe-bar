-- @param channel STRING = ALL
-- @param risk STRING = STOCKOUT
-- Top 25 store-SKUs needing attention: high stockout risk ranked by sales at risk, or high overstock ranked by expiry value.
SELECT
  recommendation_id,
  location_name,
  channel_type AS channel,
  sku_name,
  CAST(on_hand_units AS DOUBLE) AS on_hand,
  CAST(inbound_units AS DOUBLE) AS inbound,
  CAST(round((on_hand_units + inbound_units) / nullif(demand_6w_units / 6, 0), 1) AS DOUBLE) AS weeks_of_cover,
  CAST(recommended_units AS DOUBLE) AS recommended_units,
  CAST(CASE WHEN :risk = 'STOCKOUT' THEN est_lost_sales_if_no_order ELSE est_expiry_value END AS DOUBLE) AS value_at_risk
FROM darren_fe_bar_catalog.gold.replenishment_recommendations_current
WHERE (:channel = 'ALL' OR channel_type = :channel)
  AND ((:risk = 'STOCKOUT' AND stockout_risk = 'HIGH') OR (:risk = 'OVERSTOCK' AND overstock_risk = 'HIGH'))
ORDER BY value_at_risk DESC
LIMIT 25
