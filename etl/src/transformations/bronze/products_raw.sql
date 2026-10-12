-- Bronze: Product attributes: price, cost, shelf life, case pack, supplier lead time.
-- Preserves the source contract (all strings) for replay; typing and validation happen in Silver.
CREATE OR REFRESH STREAMING TABLE products_raw
COMMENT 'Product attributes: price, cost, shelf life, case pack, supplier lead time. Source folder: products/.'
TBLPROPERTIES ('quality' = 'bronze')
AS SELECT
  *,
  'PIM' AS _source_system,
  _metadata.file_path AS _source_file,
  to_date(regexp_extract(_metadata.file_path, '/([0-9]{4}-[0-9]{2}-[0-9]{2})/', 1)) AS _drop_date,
  current_timestamp() AS _ingested_at
FROM STREAM read_files(
  '${landing_path}/products/',
  format => 'csv',
  header => true,
  inferColumnTypes => false
);
