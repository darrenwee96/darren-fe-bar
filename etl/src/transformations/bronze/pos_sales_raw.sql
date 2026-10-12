-- Bronze: End-of-day item sales from the store POS (all downtown, highway, and airport stores).
-- Preserves the source contract (all strings) for replay; typing and validation happen in Silver.
CREATE OR REFRESH STREAMING TABLE pos_sales_raw
COMMENT 'End-of-day item sales from the store POS (all downtown, highway, and airport stores). Source folder: pos_sales/.'
TBLPROPERTIES ('quality' = 'bronze')
AS SELECT
  *,
  'POS' AS _source_system,
  _metadata.file_path AS _source_file,
  to_date(regexp_extract(_metadata.file_path, '/([0-9]{4}-[0-9]{2}-[0-9]{2})/', 1)) AS _drop_date,
  current_timestamp() AS _ingested_at
FROM STREAM read_files(
  '${landing_path}/pos_sales/',
  format => 'csv',
  header => true,
  inferColumnTypes => false
);
