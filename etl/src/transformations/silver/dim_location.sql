-- One row per store. Maps source channel codes to the canonical vocabulary and keeps the POS
-- store code so sales can be resolved to location_id.
CREATE OR REFRESH MATERIALIZED VIEW silver.dim_location (
  CONSTRAINT location_id_present EXPECT (location_id IS NOT NULL) ON VIOLATION FAIL UPDATE,
  CONSTRAINT valid_channel EXPECT (channel_type IN ('DOWNTOWN', 'HIGHWAY', 'AIRPORT')) ON VIOLATION FAIL UPDATE
)
COMMENT 'Stores: 32 downtown shops, 26 highway service-area kiosks, 22 airport stores.'
AS SELECT
  location_id,
  location_name,
  CASE upper(trim(channel_code))
    WHEN 'DT' THEN 'DOWNTOWN'
    WHEN 'HWY' THEN 'HIGHWAY'
    WHEN 'APT' THEN 'AIRPORT'
  END AS channel_type,
  region,
  capacity_tier,
  timezone,
  pos_store_code,
  to_date(opened_date) AS opened_date,
  active_flag = 'Y' AS active_flag
FROM locations_raw
QUALIFY row_number() OVER (PARTITION BY location_id ORDER BY _drop_date DESC, _ingested_at DESC) = 1;
