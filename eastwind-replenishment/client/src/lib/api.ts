// Typed client for the replenishment API (server/routes/replenishment-routes.ts).
// Postgres numeric / bigint values arrive as strings, so numbers are converted with Number() at render.
// Every endpoint applies the caller's planning scope server-side; the filters sent here only narrow within it.

export type Risk = 'HIGH' | 'MEDIUM' | 'LOW';
export type DecisionStatus = 'ACCEPTED' | 'ADJUSTED' | 'REJECTED';
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
  explanation_text: string | null;
  decision_status: DecisionStatus | null;
  final_order_units: Numeric | null;
  decided_by: string | null;
  decided_at: string | null;
  version: Numeric | null;
}

export interface RecommendationDetail extends RecommendationRow {
  shelf_life_days: Numeric;
  lead_time_days: Numeric;
  case_pack_units: Numeric;
  unit_cost: Numeric;
  list_price: Numeric;
  recent_weekly_units: Numeric;
  demand_cover_units: Numeric;
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

export function fetchWhoami() {
  return request<{ email: string; executesAs: string; scope: Scope }>('/api/whoami');
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
  return request<{ rows: RecommendationRow[]; total: number; limit: number; offset: number }>(
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
