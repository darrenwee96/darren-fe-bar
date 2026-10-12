-- Model contract: one row per ranged store-SKU-week, dense (zero-filled weeks while ranged).
-- Target is units_sold. Lags only look backwards and on-hand is the prior Sunday close, so
-- nothing here leaks the target week.
CREATE OR REFRESH MATERIALIZED VIEW gold.weekly_demand_features (
  CONSTRAINT one_channel EXPECT (channel_type IS NOT NULL) ON VIOLATION FAIL UPDATE,
  CONSTRAINT nonnegative_target EXPECT (units_sold >= 0) ON VIOLATION FAIL UPDATE
)
CLUSTER BY (week_start, location_id)
COMMENT 'Weekly demand features per store-SKU: lags, rolling means, event-aligned last-year demand, stockout censoring, waste, opening stock.'
AS
WITH last_sales_week AS (
  SELECT CAST(date_trunc('WEEK', max(business_date)) AS DATE) AS last_week FROM silver.fact_sales_daily
),
inventory_weekly AS (
  -- The ERP only reports ranged items, so these rows are the dense store-SKU-week spine.
  SELECT
    location_id,
    sku_id,
    CAST(date_trunc('WEEK', snapshot_date) AS DATE) AS week_start,
    count_if(stockout_flag) AS oos_days,
    count_if(NOT stockout_flag) AS in_stock_days,
    sum(received_units) AS received_units,
    sum(expired_units) AS expired_units,
    sum(expired_value) AS expired_value,
    sum(markdown_units) AS markdown_units
  FROM silver.fact_inventory_daily
  GROUP BY ALL
),
sales_weekly AS (
  SELECT
    location_id,
    sku_id,
    CAST(date_trunc('WEEK', business_date) AS DATE) AS week_start,
    sum(units_sold) AS units_sold,
    sum(gross_sales) AS gross_sales,
    sum(discount_amount) AS discount_amount,
    sum(net_sales) AS net_sales
  FROM silver.fact_sales_daily
  GROUP BY ALL
),
opening_stock AS (
  SELECT location_id, sku_id, date_add(snapshot_date, 1) AS week_start,
         on_hand_units AS on_hand_start, inbound_units AS inbound_start
  FROM silver.fact_inventory_daily
  WHERE dayofweek(snapshot_date) = 1 -- Sunday close
),
base AS (
  SELECT
    i.location_id,
    i.sku_id,
    i.week_start,
    l.channel_type,
    l.region,
    l.capacity_tier,
    p.category,
    p.gift_flag,
    p.peak_gift_flag,
    p.shelf_life_days,
    p.case_pack_units,
    p.lead_time_days,
    p.unit_cost,
    p.list_price,
    coalesce(s.units_sold, 0) AS units_sold,
    CASE
      WHEN i.oos_days > 0 AND i.oos_days < 7 THEN coalesce(s.units_sold, 0) * 7.0 / greatest(i.in_stock_days, 1)
      WHEN i.oos_days >= 7 THEN NULL
      ELSE coalesce(s.units_sold, 0)
    END AS demand_units_uncensored,
    coalesce(s.net_sales, 0) AS net_sales,
    coalesce(s.discount_amount, 0) AS markdown_value,
    CASE WHEN s.gross_sales > 0 THEN CAST(s.discount_amount / s.gross_sales AS DECIMAL(6, 4)) ELSE 0 END AS discount_pct,
    i.oos_days,
    i.in_stock_days,
    i.oos_days >= 2 AS censored_flag,
    i.received_units,
    i.expired_units,
    i.expired_value,
    i.markdown_units,
    o.on_hand_start,
    o.inbound_start,
    c.next_event_id,
    c.next_event_name,
    c.next_event_type,
    c.next_event_seq,
    c.weeks_to_next_event,
    c.weeks_to_next_event_week,
    c.days_to_next_event,
    c.days_from_week_start_to_next_event,
    c.event_window_days_in_week,
    c.event_peak_days_in_week,
    c.in_event_window
  FROM inventory_weekly i
  CROSS JOIN last_sales_week w
  JOIN silver.dim_location l ON l.location_id = i.location_id
  JOIN silver.dim_product p ON p.sku_id = i.sku_id
  JOIN silver.dim_calendar c ON c.date = i.week_start
  LEFT JOIN sales_weekly s ON s.location_id = i.location_id AND s.sku_id = i.sku_id AND s.week_start = i.week_start
  LEFT JOIN opening_stock o ON o.location_id = i.location_id AND o.sku_id = i.sku_id AND o.week_start = i.week_start
  WHERE i.week_start <= w.last_week
)
SELECT
  b.*,
  lag(b.units_sold, 1) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start) AS units_lag_1,
  lag(b.units_sold, 2) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start) AS units_lag_2,
  lag(b.units_sold, 4) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start) AS units_lag_4,
  lag(b.units_sold, 52) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start) AS units_lag_52,
  avg(b.units_sold) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING) AS units_roll_mean_4,
  avg(b.units_sold) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start ROWS BETWEEN 8 PRECEDING AND 1 PRECEDING) AS units_roll_mean_8,
  lag(b.demand_units_uncensored, 1) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start) AS demand_lag_1,
  lag(b.demand_units_uncensored, 2) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start) AS demand_lag_2,
  lag(b.demand_units_uncensored, 4) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start) AS demand_lag_4,
  lag(b.demand_units_uncensored, 52) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start) AS demand_lag_52,
  avg(b.demand_units_uncensored) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING) AS demand_roll_mean_4,
  avg(b.demand_units_uncensored) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start ROWS BETWEEN 8 PRECEDING AND 1 PRECEDING) AS demand_roll_mean_8,
  sum(b.oos_days) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING) AS oos_days_prev_4,
  sum(b.in_stock_days) OVER (PARTITION BY b.location_id, b.sku_id ORDER BY b.week_start ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING) AS in_stock_days_prev_4,
  -- Event-aligned last year: same event type, previous occurrence, same Monday-week offset to the event week.
  ly.demand_units_uncensored AS same_event_last_year_units,
  ly.week_start AS same_event_last_year_week_start
FROM base b
LEFT JOIN base ly
  ON ly.location_id = b.location_id
  AND ly.sku_id = b.sku_id
  AND ly.next_event_type = b.next_event_type
  AND ly.next_event_seq = b.next_event_seq - 1
  AND ly.weeks_to_next_event_week = b.weeks_to_next_event_week;
