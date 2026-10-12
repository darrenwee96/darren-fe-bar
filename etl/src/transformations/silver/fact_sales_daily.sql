-- Daily units and sales per store-SKU. Duplicate rows collapse to the latest delivery.
CREATE OR REFRESH MATERIALIZED VIEW silver.fact_sales_daily (
  CONSTRAINT nonnegative_units EXPECT (units_sold >= 0) ON VIOLATION FAIL UPDATE,
  CONSTRAINT nonnegative_sales EXPECT (net_sales >= 0 AND discount_amount <= gross_sales) ON VIOLATION FAIL UPDATE
)
CLUSTER BY (business_date, location_id)
COMMENT 'Daily POS sales by store-SKU. discount_amount is the markdown given on near-expiry stock.'
AS SELECT
  location_id,
  sku_id,
  business_date,
  units_sold,
  gross_sales,
  discount_amount,
  net_sales,
  CASE WHEN gross_sales > 0 THEN CAST(discount_amount / gross_sales AS DECIMAL(6, 4)) ELSE 0 END AS discount_pct,
  _source_file,
  _drop_date,
  _ingested_at
FROM sales_conformed
WHERE size(dq_issues) = 0
QUALIFY row_number() OVER (
  PARTITION BY location_id, sku_id, business_date
  ORDER BY _drop_date DESC, _ingested_at DESC, _source_file DESC
) = 1;
