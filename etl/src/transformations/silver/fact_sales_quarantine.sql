-- Rejected POS rows, kept queryable with the rules they broke.
CREATE OR REFRESH MATERIALIZED VIEW silver.fact_sales_quarantine
COMMENT 'POS rows that failed Silver rules; dq_issues lists every rule broken.'
AS SELECT
  store_code,
  item_code,
  business_date,
  units_sold,
  net_sales,
  dq_issues,
  _source_file,
  _drop_date,
  _ingested_at
FROM sales_conformed
WHERE size(dq_issues) > 0;
