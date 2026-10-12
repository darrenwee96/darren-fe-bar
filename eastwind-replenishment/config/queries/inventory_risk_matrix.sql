-- Store-SKUs at high stockout risk, by product category and channel.
SELECT
  channel_type AS channel,
  category,
  CAST(count_if(stockout_risk = 'HIGH') AS DOUBLE) AS high_stockout_skus
FROM darren_fe_bar_catalog.gold.replenishment_recommendations_current
GROUP BY channel_type, category
ORDER BY category, channel_type
