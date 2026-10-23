-- @param region STRING = ALL
-- @param channel STRING = ALL
-- @param category STRING = ALL
-- @param location_id STRING = ALL
-- @param sku_id STRING = ALL
-- Weekly units for the filtered scope: 26 weeks actual, then the latest forecast run (expected + p90) and the same
-- week last year. Only the newest forecast_run_id is read, so reruns for the same as-of date never double-count.
-- p90 is the sum of store-SKU p90s: a plan-for upper bound, not a network quantile.
-- The forecast columns repeat the last actual week so the lines join.
-- `festival` names the week a festival falls in (from each week's next-event countdown), for the chart marker.
WITH run AS (
  SELECT forecast_run_id
  FROM darren_fe_bar_catalog.gold.demand_forecasts
  GROUP BY forecast_run_id
  ORDER BY max(generated_at) DESC
  LIMIT 1
),
-- One row per key (the latest attribute), so a store that changed region or a SKU that changed category can never
-- duplicate forecast rows in the joins below.
loc AS (
  SELECT location_id, max_by(region, week_start) AS region
  FROM darren_fe_bar_catalog.gold.weekly_demand_features GROUP BY location_id
),
sku AS (
  SELECT sku_id, max_by(category, week_start) AS category
  FROM darren_fe_bar_catalog.gold.weekly_demand_features GROUP BY sku_id
),
b AS (SELECT max(week_start) AS last_week FROM darren_fe_bar_catalog.gold.weekly_demand_features),
hist AS (
  SELECT w.week_start, sum(w.units_sold) AS units, sum(coalesce(w.units_lag_52, 0)) AS last_year
  FROM darren_fe_bar_catalog.gold.weekly_demand_features w CROSS JOIN b
  WHERE w.week_start > date_sub(b.last_week, 182)
    AND (:region = 'ALL' OR w.region = :region)
    AND (:channel = 'ALL' OR w.channel_type = :channel)
    AND (:category = 'ALL' OR w.category = :category)
    AND (:location_id = 'ALL' OR w.location_id = :location_id)
    AND (:sku_id = 'ALL' OR w.sku_id = :sku_id)
  GROUP BY w.week_start
),
fc AS (
  SELECT f.forecast_week AS week_start, sum(f.forecast_units) AS units, sum(f.forecast_p90) AS p90,
         sum(f.baseline_seasonal_naive) AS last_year
  FROM darren_fe_bar_catalog.gold.demand_forecasts f
  JOIN run USING (forecast_run_id)
  JOIN loc USING (location_id)
  JOIN sku USING (sku_id)
  WHERE (:region = 'ALL' OR loc.region = :region)
    AND (:channel = 'ALL' OR f.channel_type = :channel)
    AND (:category = 'ALL' OR sku.category = :category)
    AND (:location_id = 'ALL' OR f.location_id = :location_id)
    AND (:sku_id = 'ALL' OR f.sku_id = :sku_id)
  GROUP BY f.forecast_week
),
festival AS (
  SELECT CAST(date_trunc('WEEK', date_add(w.week_start, w.days_from_week_start_to_next_event)) AS DATE) AS week_start,
         max(w.next_event_name) AS festival
  FROM darren_fe_bar_catalog.gold.weekly_demand_features w CROSS JOIN b
  WHERE w.week_start > date_sub(b.last_week, 182) AND w.next_event_name IS NOT NULL
  GROUP BY 1
),
weeks AS (
SELECT date_format(h.week_start, 'd MMM') AS week, CAST(h.units AS DOUBLE) AS actual,
       CAST(CASE WHEN h.week_start = b.last_week THEN h.units END AS DOUBLE) AS forecast,
       CAST(CASE WHEN h.week_start = b.last_week THEN h.units END AS DOUBLE) AS p90,
       CAST(h.last_year AS DOUBLE) AS last_year, CAST(h.week_start AS STRING) AS week_start
FROM hist h CROSS JOIN b
UNION ALL
SELECT date_format(week_start, 'd MMM'), CAST(NULL AS DOUBLE), CAST(round(units, 1) AS DOUBLE), CAST(round(p90, 1) AS DOUBLE),
       CAST(last_year AS DOUBLE), CAST(week_start AS STRING)
FROM fc
)
SELECT weeks.*, festival.festival
FROM weeks LEFT JOIN festival ON weeks.week_start = CAST(festival.week_start AS STRING)
ORDER BY weeks.week_start
