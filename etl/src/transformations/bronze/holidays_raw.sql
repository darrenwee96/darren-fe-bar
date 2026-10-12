-- Bronze: Named retail events with demand windows.
-- Preserves the source contract (all strings) for replay; typing and validation happen in Silver.
CREATE OR REFRESH STREAMING TABLE holidays_raw
COMMENT 'Named retail events with demand windows. Source folder: holidays/.'
TBLPROPERTIES ('quality' = 'bronze')
AS SELECT
  *,
  'PLANNING' AS _source_system,
  _metadata.file_path AS _source_file,
  to_date(regexp_extract(_metadata.file_path, '/([0-9]{4}-[0-9]{2}-[0-9]{2})/', 1)) AS _drop_date,
  current_timestamp() AS _ingested_at
FROM STREAM read_files(
  '${landing_path}/holidays/',
  format => 'csv',
  header => true,
  inferColumnTypes => false
);
