-- One row per SKU, including the replenishment inputs (case pack, supplier lead time, shelf life).
CREATE OR REFRESH MATERIALIZED VIEW silver.dim_product (
  CONSTRAINT positive_price_and_cost EXPECT (list_price > 0 AND unit_cost > 0) ON VIOLATION FAIL UPDATE,
  CONSTRAINT positive_shelf_life EXPECT (shelf_life_days > 0) ON VIOLATION FAIL UPDATE,
  CONSTRAINT positive_case_pack_and_lead_time EXPECT (case_pack_units > 0 AND lead_time_days > 0) ON VIOLATION FAIL UPDATE
)
COMMENT '32 SKUs: mooncakes, pastries, Lunar New Year gifts, tea, confectionery, snacks, pantry.'
AS SELECT
  sku_id,
  sku_name,
  category,
  gift_flag = 'Y' AS gift_flag,
  peak_gift_flag = 'Y' AS peak_gift_flag,
  CAST(shelf_life_days AS INT) AS shelf_life_days,
  CAST(case_pack_units AS INT) AS case_pack_units,
  CAST(lead_time_days AS INT) AS lead_time_days,
  CAST(unit_cost AS DECIMAL(10, 2)) AS unit_cost,
  CAST(list_price AS DECIMAL(10, 2)) AS list_price,
  to_date(launch_date) AS launch_date
FROM products_raw
QUALIFY row_number() OVER (PARTITION BY sku_id ORDER BY _drop_date DESC, _ingested_at DESC) = 1;
