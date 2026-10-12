-- Bronze: Store master with channel codes and POS store codes.
-- Preserves the source contract (all strings) for replay; typing and validation happen in Silver.
CREATE OR REFRESH STREAMING TABLE locations_raw
COMMENT 'Store master with channel codes and POS store codes. Source folder: locations/.'
TBLPROPERTIES ('quality' = 'bronze')
AS SELECT
  *,
  'MDM' AS _source_system,
  _metadata.file_path AS _source_file,
  to_date(regexp_extract(_metadata.file_path, '/([0-9]{4}-[0-9]{2}-[0-9]{2})/', 1)) AS _drop_date,
  current_timestamp() AS _ingested_at
FROM STREAM read_files(
  '${landing_path}/locations/',
  format => 'csv',
  header => true,
  inferColumnTypes => false
);
