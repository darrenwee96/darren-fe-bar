-- Business view for the VP Merchandising / Genie: weekly sales, stockout exposure, and waste
-- (expiry at cost + markdown discount) by channel and region.
CREATE OR REFRESH MATERIALIZED VIEW gold.channel_weekly_kpis
CLUSTER BY (week_start)
COMMENT 'Weekly net sales, units, stockout-day rate, censored-series share, and waste value by channel and region.'
AS SELECT
  week_start,
  channel_type,
  region,
  sum(net_sales) AS net_sales,
  sum(CASE WHEN peak_gift_flag THEN net_sales ELSE 0 END) AS peak_gift_net_sales,
  sum(units_sold) AS units_sold,
  count(*) AS ranged_series,
  sum(oos_days) / (count(*) * 7.0) AS stockout_day_rate,
  count_if(censored_flag) / count(*) AS censored_series_share,
  sum(expired_value) AS expired_value,
  sum(markdown_value) AS markdown_value,
  sum(expired_value) + sum(markdown_value) AS waste_value
FROM gold.weekly_demand_features
GROUP BY ALL;
