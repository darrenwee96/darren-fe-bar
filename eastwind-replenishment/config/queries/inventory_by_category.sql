-- @param channel STRING = ALL
-- Stock cover by category: on hand + inbound vs forecast demand, high-risk counts, and stock expected to expire.
SELECT
  category,
  CAST(sum(on_hand_units) AS DOUBLE) AS on_hand,
  CAST(sum(inbound_units) AS DOUBLE) AS inbound,
  CAST(round(sum(demand_6w_units) / 6) AS DOUBLE) AS weekly_demand,
  CAST(round((sum(on_hand_units) + sum(inbound_units)) / nullif(sum(demand_6w_units) / 6, 0), 1) AS DOUBLE) AS weeks_of_cover,
  CAST(count_if(stockout_risk = 'HIGH') AS DOUBLE) AS high_stockout,
  CAST(count_if(overstock_risk = 'HIGH') AS DOUBLE) AS high_overstock,
  CAST(sum(est_expiry_value) AS DOUBLE) AS expiry_value
FROM darren_fe_bar_catalog.gold.replenishment_recommendations_current
WHERE (:channel = 'ALL' OR channel_type = :channel)
GROUP BY category
ORDER BY weeks_of_cover
