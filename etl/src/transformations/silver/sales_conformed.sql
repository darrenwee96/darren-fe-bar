-- Pipeline-private: POS rows typed and resolved to location_id / sku_id, with dq_issues listing
-- every rule a row breaks. fact_sales_daily keeps clean rows; fact_sales_quarantine keeps the rest.
CREATE TEMPORARY VIEW sales_conformed AS
SELECT
  r.store_code,
  r.item_code,
  l.location_id,
  p.sku_id,
  try_cast(r.business_date AS DATE) AS business_date,
  try_cast(r.units AS INT) AS units_sold,
  try_cast(r.gross_amount AS DECIMAL(12, 2)) AS gross_sales,
  try_cast(r.discount_amount AS DECIMAL(12, 2)) AS discount_amount,
  try_cast(r.net_amount AS DECIMAL(12, 2)) AS net_sales,
  filter(
    array(
      CASE WHEN l.location_id IS NULL THEN 'UNKNOWN_STORE' END,
      CASE WHEN p.sku_id IS NULL THEN 'UNKNOWN_SKU' END,
      CASE WHEN try_cast(r.business_date AS DATE) IS NULL THEN 'BAD_DATE' END,
      CASE WHEN try_cast(r.units AS INT) IS NULL OR try_cast(r.units AS INT) < 0 THEN 'NEGATIVE_OR_BAD_UNITS' END,
      CASE WHEN try_cast(r.net_amount AS DECIMAL(12, 2)) IS NULL OR try_cast(r.net_amount AS DECIMAL(12, 2)) < 0 THEN 'NEGATIVE_OR_BAD_AMOUNT' END
    ),
    issue -> issue IS NOT NULL
  ) AS dq_issues,
  r._source_file,
  r._drop_date,
  r._ingested_at
FROM pos_sales_raw r
LEFT JOIN silver.dim_location l ON l.pos_store_code = r.store_code
LEFT JOIN silver.dim_product p ON p.sku_id = r.item_code;
