-- Current stock position across all store-SKUs at the forecast as-of date.
SELECT
  CAST(max(as_of_date) AS STRING) AS as_of_date,
  CAST(count(*) AS DOUBLE) AS store_skus,
  CAST(sum(on_hand_units) AS DOUBLE) AS on_hand_units,
  CAST(sum(inbound_units) AS DOUBLE) AS inbound_units,
  CAST(sum((on_hand_units + inbound_units) * unit_cost) AS DOUBLE) AS stock_value_at_cost,
  CAST(count_if(stockout_risk = 'HIGH') AS DOUBLE) AS high_stockout,
  CAST(sum(CASE WHEN stockout_risk = 'HIGH' THEN est_lost_sales_if_no_order ELSE 0 END) AS DOUBLE) AS sales_at_risk,
  CAST(count_if(overstock_risk = 'HIGH') AS DOUBLE) AS high_overstock,
  CAST(sum(est_expiry_value) AS DOUBLE) AS expiry_value,
  CAST(percentile_approx((on_hand_units + inbound_units) / nullif(demand_6w_units / 6, 0), 0.5) AS DOUBLE) AS median_weeks_of_cover
FROM darren_fe_bar_catalog.gold.replenishment_recommendations_current
