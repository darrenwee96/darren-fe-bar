// Management by exception: which order lines a planner has to look at, and which are routine.
//
// A line to order (recommended_units > 0) "needs review" when ANY rule below fires; every other line to order is
// routine and can be accepted in bulk. The thresholds live in EXCEPTION_RULES, the one place to tune them. They were
// sized on the 31 Aug 2026 order week (1,561 lines to order): 231 lines (15%) need review, 1,330 are routine.
//
//   PEAK_STOCKOUT  peak gift SKU, "order needed" (stock + inbound below demand until the next delivery) and at least
//                  peakSalesAtRisk of sales lost if not ordered                                     119 lines
//   SHELF_CAP      the order was cut to what can sell before it expires (cap_applied = SHELF_LIFE)   29 lines
//   VS_LAST_YEAR   forecast demand over the order's cover weeks is more than lastYearSwing x, or under 1/lastYearSwing
//                  of, the same festival-aligned weeks last year (gold.demand_forecasts.baseline_event_naive)
//                                                                                                    39 lines
//   VS_RECENT      non-peak SKU whose forecast over the cover weeks is more than recentSwing x, or under 1/recentSwing
//                  of, recent weekly sales (peak gifts ramp into a festival, so last year is their comparator)
//                                                                                                    46 lines
//   HIGH_VALUE     order value at cost of at least highOrderValue                                    57 lines
//
// The two swing rules ignore orders under minCasesForSwing cases, so small lines never flood the review list.
// Lines can match several rules; counts above are per rule.

export const EXCEPTION_RULES = {
  /** USD of sales lost before the next delivery if a peak gift line is not ordered. */
  peakSalesAtRisk: 10_000,
  /** USD order value at cost. */
  highOrderValue: 10_000,
  /** Forecast vs last year's same festival weeks: flag above this ratio or below its inverse. */
  lastYearSwing: 2,
  /** Non-peak forecast vs recent weekly sales: flag above this ratio or below its inverse. */
  recentSwing: 3,
  /** Swing rules only apply to orders of at least this many cases. */
  minCasesForSwing: 2,
} as const;

export const EXCEPTION_REASONS = ['PEAK_STOCKOUT', 'SHELF_CAP', 'VS_LAST_YEAR', 'VS_RECENT', 'HIGH_VALUE'] as const;
export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];

/** Weeks of demand an order covers: lead time in whole weeks plus the 7-day review cycle (build_recommendations.py). */
const COVER_WEEKS = `(ceil(r.lead_time_days / 7.0) + 1)`;

/**
 * SQL text[] of the rules a line matches, for `r` = serving.recommendations and `c` = replenishment.line_context.
 * Thresholds are numeric constants from EXCEPTION_RULES, never user input.
 */
export function exceptionReasonsSql(rules: Record<keyof typeof EXCEPTION_RULES, number> = EXCEPTION_RULES): string {
  const n = (v: number) => {
    if (!Number.isFinite(v)) throw new Error('Exception thresholds must be finite numbers');
    return String(v);
  };
  const bigEnough = `r.recommended_units >= ${n(rules.minCasesForSwing)} * r.case_pack_units`;
  const recentCover = `(r.recent_weekly_units * ${COVER_WEEKS})`;
  return `array_remove(ARRAY[
    CASE WHEN r.peak_gift_flag AND r.stockout_risk = 'HIGH'
              AND r.est_lost_sales_if_no_order >= ${n(rules.peakSalesAtRisk)} THEN 'PEAK_STOCKOUT' END,
    CASE WHEN r.cap_applied = 'SHELF_LIFE' THEN 'SHELF_CAP' END,
    CASE WHEN ${bigEnough} AND c.last_year_cover_units > 0
              AND (r.demand_cover_units > ${n(rules.lastYearSwing)} * c.last_year_cover_units
                   OR r.demand_cover_units * ${n(rules.lastYearSwing)} < c.last_year_cover_units) THEN 'VS_LAST_YEAR' END,
    CASE WHEN NOT r.peak_gift_flag AND ${bigEnough} AND r.recent_weekly_units > 0
              AND (r.demand_cover_units > ${n(rules.recentSwing)} * ${recentCover}
                   OR r.demand_cover_units * ${n(rules.recentSwing)} < ${recentCover}) THEN 'VS_RECENT' END,
    CASE WHEN r.recommended_units * r.unit_cost >= ${n(rules.highOrderValue)} THEN 'HIGH_VALUE' END
  ]::text[], NULL)`;
}

/**
 * Last year's demand over each line's cover weeks, festival-aligned (the same weeks relative to the festival, not
 * the same calendar weeks), from the forecast run the recommendation was built on. Runs on the SQL warehouse as the
 * app service principal (SELECT on both Gold tables).
 */
export const LAST_YEAR_COVER_SQL = `
  SELECT r.recommendation_id, r.forecast_run_id,
         CAST(sum(f.baseline_event_naive) AS DOUBLE) AS last_year_cover_units
  FROM darren_fe_bar_catalog.gold.replenishment_recommendations_current r
  JOIN darren_fe_bar_catalog.gold.demand_forecasts f
    ON f.forecast_run_id = r.forecast_run_id AND f.location_id = r.location_id AND f.sku_id = r.sku_id
  WHERE f.horizon <= ceil(r.lead_time_days / 7.0) + 1
  GROUP BY r.recommendation_id, r.forecast_run_id`;
