-- Daily calendar with Monday-based weeks and the next gifting event. event_seq numbers each
-- event type's occurrences so Gold can align "same event last year" (lunar holidays move 1-3
-- weeks between years). Travel holidays flag in_event_window but are not a "next event".
CREATE OR REFRESH MATERIALIZED VIEW silver.dim_calendar
COMMENT 'One row per day: week_start (Monday), next gifting event, days/weeks to it, event-window and target-week event day counts.'
AS
WITH events AS (
  SELECT
    holiday_id,
    holiday_name,
    event_type,
    to_date(event_date) AS event_date,
    to_date(window_start) AS window_start,
    to_date(window_end) AS window_end,
    row_number() OVER (PARTITION BY event_type ORDER BY to_date(event_date)) AS event_seq
  FROM holidays_raw
  QUALIFY row_number() OVER (PARTITION BY holiday_id ORDER BY _drop_date DESC, _ingested_at DESC) = 1
),
days AS (
  SELECT explode(sequence(DATE'2023-01-02', max(event_date))) AS date FROM events
),
next_event AS (
  SELECT
    d.date,
    min_by(struct(e.holiday_id, e.holiday_name, e.event_type, e.event_date, e.window_start, e.window_end, e.event_seq), e.event_date) AS ev
  FROM days d
  JOIN events e ON e.event_date >= d.date AND e.event_type <> 'TRAVEL_HOLIDAY'
  GROUP BY d.date
),
active_window AS (
  SELECT d.date, max_by(e.holiday_name, e.event_date) AS active_event_name
  FROM days d
  JOIN events e ON d.date BETWEEN e.window_start AND e.window_end
  GROUP BY d.date
)
SELECT
  d.date,
  CAST(date_trunc('WEEK', d.date) AS DATE) AS week_start,
  year(d.date) AS calendar_year,
  dayofweek(d.date) AS day_of_week,
  n.ev.holiday_id AS next_event_id,
  n.ev.holiday_name AS next_event_name,
  n.ev.event_type AS next_event_type,
  n.ev.event_seq AS next_event_seq,
  n.ev.event_date AS next_event_date,
  datediff(n.ev.event_date, d.date) AS days_to_next_event,
  CAST(floor(datediff(n.ev.event_date, d.date) / 7) AS INT) AS weeks_to_next_event,
  CAST(datediff(CAST(date_trunc('WEEK', n.ev.event_date) AS DATE), CAST(date_trunc('WEEK', d.date) AS DATE)) / 7 AS INT) AS weeks_to_next_event_week,
  datediff(n.ev.event_date, CAST(date_trunc('WEEK', d.date) AS DATE)) AS days_from_week_start_to_next_event,
  size(array_intersect(
    sequence(CAST(date_trunc('WEEK', d.date) AS DATE), date_add(CAST(date_trunc('WEEK', d.date) AS DATE), 6)),
    sequence(n.ev.window_start, n.ev.window_end)
  )) AS event_window_days_in_week,
  CASE
    WHEN n.ev.event_date BETWEEN CAST(date_trunc('WEEK', d.date) AS DATE) AND date_add(CAST(date_trunc('WEEK', d.date) AS DATE), 6)
    THEN 1 ELSE 0
  END AS event_peak_days_in_week,
  w.active_event_name,
  w.active_event_name IS NOT NULL AS in_event_window
FROM days d
LEFT JOIN next_event n USING (date)
LEFT JOIN active_window w USING (date);
