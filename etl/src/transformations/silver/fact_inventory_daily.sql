-- Daily stock position per ranged store-SKU (the ERP only reports ranged items, so this table
-- also defines the assortment). Carries the waste signals: expiry write-offs and markdown units.
CREATE OR REFRESH MATERIALIZED VIEW silver.fact_inventory_daily (
  CONSTRAINT known_store_and_sku EXPECT (location_known AND sku_known) ON VIOLATION DROP ROW,
  CONSTRAINT nonnegative_quantities EXPECT (
    on_hand_units >= 0 AND inbound_units >= 0 AND received_units >= 0 AND expired_units >= 0 AND markdown_units >= 0
  ) ON VIOLATION DROP ROW
)
CLUSTER BY (snapshot_date, location_id)
COMMENT 'End-of-day on-hand and inbound; stockout_flag = no stock on hand. expired_value at cost.'
AS
WITH inv AS (
  SELECT
    location_id,
    sku_id,
    to_date(snapshot_date) AS snapshot_date,
    CAST(on_hand_units AS INT) AS on_hand_units,
    CAST(inbound_units AS INT) AS inbound_units,
    CAST(received_units AS INT) AS received_units,
    CAST(expired_units AS INT) AS expired_units,
    CAST(markdown_units AS INT) AS markdown_units,
    _source_file,
    _ingested_at
  FROM inventory_raw
  QUALIFY row_number() OVER (PARTITION BY location_id, sku_id, snapshot_date ORDER BY _drop_date DESC, _ingested_at DESC) = 1
)
SELECT
  i.location_id,
  i.sku_id,
  i.snapshot_date,
  i.on_hand_units,
  i.inbound_units,
  i.received_units,
  i.expired_units,
  i.markdown_units,
  i.on_hand_units = 0 AS stockout_flag,
  CAST(i.expired_units * p.unit_cost AS DECIMAL(12, 2)) AS expired_value,
  l.location_id IS NOT NULL AS location_known,
  p.sku_id IS NOT NULL AS sku_known,
  i._source_file,
  i._ingested_at
FROM inv i
LEFT JOIN silver.dim_location l ON l.location_id = i.location_id
LEFT JOIN silver.dim_product p ON p.sku_id = i.sku_id;
