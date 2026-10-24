import type { ExceptionReason, ExceptionRules, RecommendationRow } from './api';
import { costOf, formatInt, formatUsd, toNumber } from './format';

/** Short chip label per exception rule. The thresholds come from the server (EXCEPTION_RULES, via /api/whoami). */
export const EXCEPTION_LABEL: Record<ExceptionReason, string> = {
  PEAK_STOCKOUT: 'Peak gift at risk',
  SHELF_CAP: 'Shelf-life cap',
  VS_LAST_YEAR: 'Unlike last year',
  VS_RECENT: 'Unlike recent sales',
  HIGH_VALUE: 'High value',
};

/** What each rule means, worded from the live thresholds. */
export function exceptionRuleText(reason: ExceptionReason, rules: ExceptionRules | null | undefined): string {
  if (!rules) return EXCEPTION_LABEL[reason];
  switch (reason) {
    case 'PEAK_STOCKOUT':
      return `Peak gift line that needs an order, with ${formatUsd(rules.peakSalesAtRisk)}+ of sales lost if it is not ordered`;
    case 'SHELF_CAP':
      return 'Order cut to what can sell before it expires';
    case 'VS_LAST_YEAR':
      return `Forecast over ${rules.lastYearSwing}× or under 1/${rules.lastYearSwing} of the same festival weeks last year (orders of ${rules.minCasesForSwing}+ cases)`;
    case 'VS_RECENT':
      return `Non-peak forecast over ${rules.recentSwing}× or under 1/${rules.recentSwing} of recent sales (orders of ${rules.minCasesForSwing}+ cases)`;
    case 'HIGH_VALUE':
      return `Order worth ${formatUsd(rules.highOrderValue)} or more at cost`;
  }
}

/** Weeks of demand an order covers: lead time in whole weeks + the weekly review cycle. */
export const coverWeeks = (leadTimeDays: number | string) => Math.ceil(toNumber(leadTimeDays) / 7) + 1;

/** The numbers behind a rule for one line, for the chip tooltip and the line sheet. */
export function exceptionDetail(reason: ExceptionReason, r: RecommendationRow): string {
  const weeks = coverWeeks(r.lead_time_days);
  const forecast = toNumber(r.demand_cover_units);
  switch (reason) {
    case 'PEAK_STOCKOUT':
      return `${formatUsd(r.est_lost_sales_if_no_order)} of peak sales lost if not ordered`;
    case 'SHELF_CAP':
      return 'Order capped by shelf life';
    case 'VS_LAST_YEAR':
      return `Forecast ${formatInt(forecast)} units over ${weeks} wks vs ${formatInt(r.last_year_cover_units)} in the same festival weeks last year`;
    case 'VS_RECENT':
      return `Forecast ${formatInt(forecast)} units over ${weeks} wks vs ${formatInt(toNumber(r.recent_weekly_units) * weeks)} at recent sales`;
    case 'HIGH_VALUE':
      return r.unit_cost === null
        ? 'High order value at cost (unit cost is masked in this view)'
        : `${formatUsd(costOf(r.recommended_units, r.unit_cost))} at cost`;
  }
}
