// Typed client for the replenishment API (server/routes/replenishment-routes.ts).
// Postgres numeric / bigint values arrive as strings, so numbers are converted with Number() at render.

export type Risk = 'HIGH' | 'MEDIUM' | 'LOW';
export type DecisionStatus = 'ACCEPTED' | 'ADJUSTED' | 'REJECTED';
type Numeric = number | string;

export interface Summary {
  as_of_date: string;
  model_version: string;
  refreshed_at: string;
  loaded_at: string;
  store_skus: Numeric;
  lines_to_order: Numeric;
  recommended_units: Numeric;
  order_value_at_cost: Numeric;
  high_stockout_risk: Numeric;
  high_risk_lost_sales: Numeric;
  shelf_capped: Numeric;
  high_overstock_risk: Numeric;
  decided_lines: Numeric;
  accepted: Numeric;
  adjusted: Numeric;
  rejected: Numeric;
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

export interface ListFilters {
  region?: string;
  channel?: string;
  risk?: Risk;
  status?: 'PENDING' | DecisionStatus;
  search?: string;
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

export function fetchSummary() {
  return request<Summary>('/api/recommendations/summary');
}

export function fetchWhoami() {
  return request<{ email: string; executesAs: string }>('/api/whoami');
}

export function fetchRecommendations(filters: ListFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return request<{ rows: RecommendationRow[]; total: number; limit: number; offset: number }>(
    `/api/recommendations?${params.toString()}`
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
  return request<{ version: Numeric }>(`/api/recommendations/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
