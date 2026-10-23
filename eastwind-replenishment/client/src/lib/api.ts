// Typed client for the replenishment API (server/routes/replenishment-routes.ts).
// Postgres numeric / bigint values arrive as strings, so numbers are converted with Number() at render.
// Every endpoint applies the caller's planning scope server-side; the filters sent here only narrow within it.

export type Risk = 'HIGH' | 'MEDIUM' | 'LOW';
export type DecisionStatus = 'ACCEPTED' | 'ADJUSTED' | 'REJECTED';
export type DecisionSource = 'single' | 'bulk';
/** Exception rules (server/routes/exceptions.ts). A line to order with none of these is routine. */
export type ExceptionReason = 'PEAK_STOCKOUT' | 'SHELF_CAP' | 'VS_LAST_YEAR' | 'VS_RECENT' | 'HIGH_VALUE';
export type Segment = 'ALL' | 'EXCEPTIONS' | 'ROUTINE';
type Numeric = number | string;

export interface Scope {
  restricted: boolean;
  regions: string[];
  locations: string[];
}

export interface Summary {
  as_of_date: string | null;
  model_version: string | null;
  refreshed_at: string | null;
  loaded_at: string | null;
  store_skus: Numeric;
  lines_to_order: Numeric;
  recommended_units: Numeric;
  order_value_at_cost: Numeric;
  needs_order: Numeric;
  needs_order_sales: Numeric;
  peak_lines: Numeric;
  peak_needs_order: Numeric;
  peak_needs_order_sales: Numeric;
  peak_needs_order_pending: Numeric;
  shelf_capped: Numeric;
  high_overstock_risk: Numeric;
  expiry_value: Numeric;
  decided_lines: Numeric;
  pending_lines: Numeric;
  pending_value_at_cost: Numeric;
  accepted: Numeric;
  adjusted: Numeric;
  rejected: Numeric;
  exception_lines: Numeric;
  exception_pending: Numeric;
  exception_pending_at_risk: Numeric;
  exception_pending_stores: Numeric;
  routine_lines: Numeric;
  routine_pending: Numeric;
  routine_pending_units: Numeric;
  routine_pending_value_at_cost: Numeric;
  /** Lines with last year's festival-week demand loaded; 0 means the last-year rule cannot fire yet. */
  last_year_context_lines: Numeric;
}

export interface StoreNeed {
  location_id: string;
  location_name: string;
  region: string;
  channel_type: string;
  needs_order: Numeric;
  safety_top_up: Numeric;
  pending_lines: Numeric;
  needs_order_sales: Numeric;
}

export interface StoreOption {
  location_id: string;
  location_name: string;
  region: string;
  channel_type: string;
}

export interface FilterOptions {
  regions: string[];
  categories: string[];
  stores: StoreOption[];
  scope: Scope;
}

export interface RecommendationRow {
  recommendation_id: string;
  as_of_date: string;
  location_id: string;
  location_name: string;
  channel_type: string;
  region: string;
  sku_id: string;
  sku_name: string;
  category: string;
  peak_gift_flag: boolean;
  on_hand_units: Numeric;
  inbound_units: Numeric;
  recommended_units: Numeric;
  cap_applied: 'NONE' | 'SHELF_LIFE';
  stockout_risk: Risk;
  overstock_risk: Risk;
  est_lost_sales_if_no_order: Numeric;
  est_expiry_value: Numeric;
  unit_cost: Numeric;
  recent_weekly_units: Numeric;
  demand_cover_units: Numeric;
  lead_time_days: Numeric;
  last_year_cover_units: Numeric | null;
  explanation_text: string | null;
  exception_reasons: ExceptionReason[];
  /** Sales lost if not ordered + stock expected to expire (USD). */
  at_risk: Numeric;
  decision_status: DecisionStatus | null;
  final_order_units: Numeric | null;
  decided_by: string | null;
  decided_at: string | null;
  version: Numeric | null;
  decision_source: DecisionSource | null;
}

export interface RecommendationListRow extends RecommendationRow {
  /** Totals for the row's store within the current filters (for the store group header). */
  store_at_risk: Numeric;
  store_lines: Numeric;
}

export interface RecommendationDetail extends RecommendationRow {
  shelf_life_days: Numeric;
  case_pack_units: Numeric;
  list_price: Numeric;
  safety_units: Numeric;
  demand_6w_units: Numeric;
  sellable_before_expiry_units: Numeric;
  top_driver: string;
  model_version: string;
  refreshed_at: string;
  reason: string | null;
}

export interface DecisionEvent {
  event_id: string;
  previous_status: DecisionStatus | null;
  new_status: DecisionStatus;
  previous_units: Numeric | null;
  new_units: Numeric;
  reason: string | null;
  changed_by: string;
  changed_at: string;
  decision_source: DecisionSource | null;
}

/** Global control-panel filters (undefined = all). */
export interface ScopeFilters {
  region?: string;
  channel?: string;
  category?: string;
  location?: string;
}

export interface ListFilters extends ScopeFilters {
  risk?: Risk;
  status?: 'PENDING' | 'DECIDED' | DecisionStatus;
  search?: string;
  peakOnly: boolean;
  actionableOnly: boolean;
  segment: Segment;
  limit: number;
  offset: number;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

function query(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

/** Thresholds behind the exception rules (server/routes/exceptions.ts EXCEPTION_RULES). */
export interface ExceptionRules {
  peakSalesAtRisk: number;
  highOrderValue: number;
  lastYearSwing: number;
  recentSwing: number;
  minCasesForSwing: number;
}

export function fetchWhoami() {
  return request<{ email: string; executesAs: string; scope: Scope; exceptionRules: ExceptionRules }>('/api/whoami');
}

export function fetchFilterOptions() {
  return request<FilterOptions>('/api/filters');
}

export function fetchSummary(filters: ScopeFilters) {
  return request<Summary>(`/api/recommendations/summary?${query(filters)}`);
}

export function fetchStoreNeeds(filters: ScopeFilters) {
  return request<{ rows: StoreNeed[] }>(`/api/recommendations/by-store?${query(filters)}`);
}

export function fetchRecommendations(filters: ListFilters) {
  return request<{ rows: RecommendationListRow[]; total: number; limit: number; offset: number }>(
    `/api/recommendations?${query(filters)}`
  );
}

export function fetchRecommendation(id: string) {
  return request<{ recommendation: RecommendationDetail; events: DecisionEvent[] }>(
    `/api/recommendations/${encodeURIComponent(id)}`
  );
}

export function saveDecision(
  id: string,
  body: { status: DecisionStatus; finalUnits?: number; reason?: string; expectedVersion: number | null }
) {
  return request<{ version: Numeric; decision_status: DecisionStatus; final_order_units: Numeric }>(
    `/api/recommendations/${encodeURIComponent(id)}/decision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

export interface BulkItem {
  id: string;
  expectedVersion: number | null;
}

export interface RoutinePending {
  count: number;
  truncated: boolean;
  units: number;
  valueAtCost: number;
  items: BulkItem[];
}

/** Pending routine lines in your scope + filters, exactly as "Accept all routine" will submit them. */
export function fetchRoutinePending(filters: ScopeFilters) {
  return request<RoutinePending>(`/api/recommendations/routine?${query(filters)}`);
}

export interface BulkLineResult {
  id: string;
  /** 201/200 accepted; 403 out of scope; 404 unknown; 409 changed by someone else; 422 nothing to order. */
  status: 200 | 201 | 403 | 404 | 409 | 422;
  error?: string;
  version?: number;
  currentVersion?: number | null;
}

export interface BulkOutcome {
  requested: number;
  accepted: number;
  acceptedUnits: number;
  results: BulkLineResult[];
}

/**
 * Accept many lines at their recommended quantity. Answers 200 (all accepted), 207 (some lines refused, listed per
 * line) or 403 (none in your scope) with the same body, so partial results are never lost.
 */
export async function bulkAccept(items: BulkItem[]): Promise<BulkOutcome> {
  const res = await fetch('/api/recommendations/bulk-accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (typeof body === 'object' && body !== null && 'results' in body && Array.isArray(body.results)) {
    return body as BulkOutcome;
  }
  const message =
    typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `Request failed (${res.status})`;
  throw new ApiError(message, res.status);
}
