// Replenishment control-panel API.
//
// Lakebase layout (database databricks_postgres):
//   serving.recommendations         loaded from Gold by the eastwind-forecast job; read-only here
//   replenishment.order_decisions   one current decision per recommendation (app-owned)
//   replenishment.decision_events   append-only audit trail (app-owned)
//   replenishment.user_scope        which regions / stores each planner may see and decide (app-owned)
//   replenishment.line_context      last year's festival-aligned demand per line, copied from Gold (app-owned)
// The app's service principal creates and owns `replenishment` at startup; the load job grants it
// SELECT on `serving`.
//
// Identity comes from ./identity (the user's forwarded token, verified with the workspace), never from a bare header.
// Scoping is enforced here, not in the UI, and fails closed: every read and write joins the caller's scope from
// replenishment.user_scope; a user with no rows sees nothing. Client filters (region, store, ...) only narrow within it.
//
// Management by exception (./exceptions): each line to order either needs review or is routine. Routine lines, and
// any selection of lines, can be accepted in bulk; every line still gets its own decision row, audit event, version
// check and scope check, and the response reports each line that could not be accepted.

import { z } from 'zod';
import type { Application, Response } from 'express';
import { EXCEPTION_RULES, exceptionReasonsSql } from './exceptions';
import { createIdentityResolver, defaultIdentityOptions, requireUser, type IdentityOptions } from './identity';
import { startLineContextSync, type Warehouse } from './line-context';

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
}

interface PoolClient {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
  release(): void;
}

export interface Lakebase {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
  pool: { connect(): Promise<PoolClient> };
}

interface AppKitWithLakebase {
  lakebase: Lakebase;
  analytics?: Warehouse;
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const SETUP_SQL = [
  `CREATE SCHEMA IF NOT EXISTS replenishment`,
  `CREATE TABLE IF NOT EXISTS replenishment.order_decisions (
     decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     recommendation_id TEXT NOT NULL UNIQUE,
     as_of_date DATE NOT NULL,
     location_id TEXT NOT NULL,
     sku_id TEXT NOT NULL,
     decision_status TEXT NOT NULL CHECK (decision_status IN ('ACCEPTED', 'ADJUSTED', 'REJECTED')),
     recommended_units INTEGER NOT NULL,
     final_order_units INTEGER NOT NULL CHECK (final_order_units >= 0),
     reason TEXT,
     decided_by TEXT NOT NULL,
     decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     version INTEGER NOT NULL DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS replenishment.decision_events (
     event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     decision_id UUID NOT NULL,
     recommendation_id TEXT NOT NULL,
     previous_status TEXT,
     new_status TEXT NOT NULL,
     previous_units INTEGER,
     new_units INTEGER NOT NULL,
     reason TEXT,
     changed_by TEXT NOT NULL,
     changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS decision_events_recommendation_idx
     ON replenishment.decision_events (recommendation_id, changed_at)`,
  `CREATE TABLE IF NOT EXISTS replenishment.user_scope (
     user_email TEXT NOT NULL,
     region TEXT,
     location_id TEXT,
     CHECK (region IS NOT NULL OR location_id IS NOT NULL)
   )`,
  `CREATE INDEX IF NOT EXISTS user_scope_email_idx ON replenishment.user_scope (lower(user_email))`,
  `ALTER TABLE replenishment.user_scope ADD COLUMN IF NOT EXISTS note TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS user_scope_grant_uq
     ON replenishment.user_scope (lower(user_email), coalesce(region, ''), coalesce(location_id, ''))`,
  // v2: how each decision was made ('single' line or 'bulk' accept). Existing rows were all single-line decisions.
  `ALTER TABLE replenishment.order_decisions ADD COLUMN IF NOT EXISTS decision_source TEXT NOT NULL DEFAULT 'single'`,
  `ALTER TABLE replenishment.decision_events ADD COLUMN IF NOT EXISTS decision_source TEXT NOT NULL DEFAULT 'single'`,
  `DO $$ BEGIN
     ALTER TABLE replenishment.order_decisions
       ADD CONSTRAINT order_decisions_source_check CHECK (decision_source IN ('single', 'bulk'));
   EXCEPTION WHEN duplicate_object THEN NULL;
   END $$`,
  `CREATE TABLE IF NOT EXISTS replenishment.line_context (
     recommendation_id TEXT PRIMARY KEY,
     forecast_run_id TEXT,
     last_year_cover_units DOUBLE PRECISION,
     refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
];

/** region = '*' grants every region and store (analysts / planners). It must be granted explicitly. */
export const ALL_REGIONS = '*';

/**
 * Idempotent demo seed: network-wide rows for REPLENISHMENT_ANALYSTS (comma-separated emails, set in app.yaml) plus
 * two sample store-manager mappings. Existing rows are left alone; remove a row to revoke.
 */
export function scopeSeedRows(analysts = process.env.REPLENISHMENT_ANALYSTS ?? '') {
  const rows: [string, string | null, string | null, string][] = analysts
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
    .map((email) => [email, ALL_REGIONS, null, 'Network-wide analyst (seeded from REPLENISHMENT_ANALYSTS)']);
  rows.push(
    ['north.manager@eastwind.example', 'North', null, 'Sample: North region manager'],
    ['daan3.manager@eastwind.example', null, 'L0022', 'Sample: Daan Shop 3 store manager']
  );
  return rows;
}

const SEED_SQL = `
  INSERT INTO replenishment.user_scope (user_email, region, location_id, note) VALUES ($1, $2, $3, $4)
  ON CONFLICT (lower(user_email), coalesce(region, ''), coalesce(location_id, '')) DO NOTHING`;

const RISKS = ['HIGH', 'MEDIUM', 'LOW'] as const;
const STATUSES = ['PENDING', 'DECIDED', 'ACCEPTED', 'ADJUSTED', 'REJECTED'] as const;
const CHANNELS = ['DOWNTOWN', 'HIGHWAY', 'AIRPORT'] as const;

const ScopeFilters = z.object({
  region: z.string().trim().min(1).max(40).optional(),
  channel: z.enum(CHANNELS).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  location: z.string().trim().min(1).max(20).optional(),
});

const ListQuery = ScopeFilters.extend({
  risk: z.enum(RISKS).optional(),
  status: z.enum(STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  peakOnly: z.enum(['true', 'false']).default('false'),
  /** EXCEPTIONS = lines to order that need review (grouped by store); ROUTINE = the other lines to order. */
  segment: z.enum(['ALL', 'EXCEPTIONS', 'ROUTINE']).default('ALL'),
  actionableOnly: z.enum(['true', 'false']).default('true'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const DecisionBody = z
  .object({
    status: z.enum(['ACCEPTED', 'ADJUSTED', 'REJECTED']),
    finalUnits: z.number().int().min(0).max(100000).optional(),
    reason: z.string().trim().max(500).optional(),
    expectedVersion: z.number().int().min(1).nullable(),
  })
  .refine((b) => b.status !== 'ADJUSTED' || (b.finalUnits !== undefined && !!b.reason), {
    message: 'An adjusted order needs the new quantity and a reason',
  })
  .refine((b) => b.status !== 'REJECTED' || !!b.reason, { message: 'A rejected order needs a reason' });

/** Most lines one bulk accept may carry (a network-wide routine accept is ~1,300 lines). */
export const BULK_MAX_LINES = 2000;

const BulkAcceptBody = z.object({
  items: z
    .array(z.object({ id: z.string().trim().min(1).max(64), expectedVersion: z.number().int().min(1).nullable() }))
    .min(1, 'Select at least one order line')
    .max(BULK_MAX_LINES, `Accept at most ${BULK_MAX_LINES} lines at a time`)
    .refine((items) => new Set(items.map((i) => i.id)).size === items.length, 'Each order line can appear only once'),
});

export interface Scope {
  /** false = network-wide (an explicit '*' grant); true = only the listed regions / stores (possibly none). */
  restricted: boolean;
  regions: string[];
  locations: string[];
}

/**
 * Resolve the caller's planning scope from replenishment.user_scope. Fail-closed: a user without rows gets an empty
 * scope (sees nothing, 403 on decisions). region = '*' is the explicit network-wide grant.
 */
export async function resolveScope(db: Lakebase, user: string): Promise<Scope> {
  const { rows } = await db.query(
    'SELECT region, location_id FROM replenishment.user_scope WHERE lower(user_email) = lower($1)',
    [user]
  );
  if (rows.some((r) => r.region === ALL_REGIONS)) return { restricted: false, regions: [], locations: [] };
  const pick = (key: string) => [
    ...new Set(rows.map((r) => r[key]).filter((v): v is string => typeof v === 'string' && v.length > 0)),
  ];
  return { restricted: true, regions: pick('region'), locations: pick('location_id') };
}

/** `r` row is visible when the scope is open, or its region or store is in the caller's scope. */
const scopeSql = (n: number) =>
  `(NOT $${n}::boolean OR r.region = ANY($${n + 1}::text[]) OR r.location_id = ANY($${n + 2}::text[]))`;
const scopeParams = (s: Scope) => [s.restricted, s.regions, s.locations];

/** Shared filters: region, channel, category, store ($1-$4), then scope ($5-$7). */
const FILTER_SQL = `
  ($1::text IS NULL OR r.region = $1)
  AND ($2::text IS NULL OR r.channel_type = $2)
  AND ($3::text IS NULL OR r.category = $3)
  AND ($4::text IS NULL OR r.location_id = $4)
  AND ${scopeSql(5)}`;
const filterParams = (f: z.infer<typeof ScopeFilters>, s: Scope) => [
  f.region ?? null,
  f.channel ?? null,
  f.category ?? null,
  f.location ?? null,
  ...scopeParams(s),
];

function servingUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /serving\.recommendations|schema "serving"|permission denied/.test(message);
}

/**
 * Every recommendation with its current decision, last-year context and the exception rules it matches. Exposes
 * `exception_reasons` (text[]) and `at_risk` (sales lost if not ordered + stock expected to expire, USD).
 */
const LINES_FROM = `
  FROM serving.recommendations r
  LEFT JOIN replenishment.order_decisions d USING (recommendation_id)
  LEFT JOIN replenishment.line_context c USING (recommendation_id)
  CROSS JOIN LATERAL (
    SELECT ${exceptionReasonsSql()} AS exception_reasons,
           coalesce(r.est_lost_sales_if_no_order, 0) + coalesce(r.est_expiry_value, 0) AS at_risk
  ) x`;

const IS_EXCEPTION = `(r.recommended_units > 0 AND cardinality(x.exception_reasons) > 0)`;
const IS_ROUTINE = `(r.recommended_units > 0 AND cardinality(x.exception_reasons) = 0)`;

const LIST_SQL = `
  SELECT r.recommendation_id, r.as_of_date::text AS as_of_date, r.location_id, r.location_name, r.channel_type, r.region,
         r.sku_id, r.sku_name, r.category, r.peak_gift_flag, r.on_hand_units, r.inbound_units, r.recommended_units,
         r.cap_applied, r.stockout_risk, r.overstock_risk, r.est_lost_sales_if_no_order, r.est_expiry_value,
         r.unit_cost, r.recent_weekly_units, r.demand_cover_units, r.lead_time_days, c.last_year_cover_units,
         r.explanation_text, x.exception_reasons, x.at_risk,
         sum(x.at_risk) OVER (PARTITION BY r.location_id) AS store_at_risk,
         count(*) OVER (PARTITION BY r.location_id) AS store_lines,
         d.decision_status, d.final_order_units, d.decided_by, d.decided_at, d.version, d.decision_source,
         count(*) OVER () AS total
  ${LINES_FROM}
  WHERE ${FILTER_SQL}
    AND ($8::text IS NULL OR r.stockout_risk = $8)
    AND ($9::text IS NULL OR ($9 = 'PENDING' AND d.decision_status IS NULL)
         OR ($9 = 'DECIDED' AND d.decision_status IS NOT NULL) OR d.decision_status = $9)
    AND ($10::text IS NULL OR r.location_name ILIKE '%' || $10 || '%' OR r.sku_name ILIKE '%' || $10 || '%')
    AND (NOT $11::boolean OR r.recommended_units > 0 OR r.stockout_risk <> 'LOW' OR r.overstock_risk = 'HIGH')
    AND (NOT $12::boolean OR r.peak_gift_flag)
    AND ($15 = 'ALL' OR ($15 = 'EXCEPTIONS' AND ${IS_EXCEPTION}) OR ($15 = 'ROUTINE' AND ${IS_ROUTINE}))
  ORDER BY
    -- Needs review: stores with the most at stake first, then each store's lines by $ at risk.
    CASE WHEN $15 = 'EXCEPTIONS' THEN sum(x.at_risk) OVER (PARTITION BY r.location_id) END DESC NULLS LAST,
    CASE WHEN $15 = 'EXCEPTIONS' THEN r.location_id END,
    CASE WHEN $15 = 'EXCEPTIONS' THEN x.at_risk END DESC NULLS LAST,
    CASE r.stockout_risk WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
    x.at_risk DESC,
    r.recommended_units DESC,
    r.recommendation_id
  LIMIT $13 OFFSET $14`;

const SUMMARY_SQL = `
  SELECT max(r.as_of_date)::text AS as_of_date,
         max(r.model_version) AS model_version,
         max(r.refreshed_at) AS refreshed_at,
         max(r.loaded_at) AS loaded_at,
         count(*) AS store_skus,
         count(*) FILTER (WHERE r.recommended_units > 0) AS lines_to_order,
         coalesce(sum(r.recommended_units), 0) AS recommended_units,
         coalesce(sum(r.recommended_units * r.unit_cost), 0) AS order_value_at_cost,
         count(*) FILTER (WHERE r.stockout_risk = 'HIGH') AS needs_order,
         coalesce(sum(r.est_lost_sales_if_no_order) FILTER (WHERE r.stockout_risk = 'HIGH'), 0) AS needs_order_sales,
         count(*) FILTER (WHERE r.peak_gift_flag) AS peak_lines,
         count(*) FILTER (WHERE r.peak_gift_flag AND r.stockout_risk = 'HIGH') AS peak_needs_order,
         coalesce(sum(r.est_lost_sales_if_no_order) FILTER (WHERE r.peak_gift_flag AND r.stockout_risk = 'HIGH'), 0)
           AS peak_needs_order_sales,
         count(*) FILTER (WHERE r.peak_gift_flag AND r.stockout_risk = 'HIGH' AND d.decision_status IS NULL)
           AS peak_needs_order_pending,
         count(*) FILTER (WHERE r.cap_applied = 'SHELF_LIFE') AS shelf_capped,
         count(*) FILTER (WHERE r.overstock_risk = 'HIGH') AS high_overstock_risk,
         coalesce(sum(r.est_expiry_value), 0) AS expiry_value,
         count(d.recommendation_id) FILTER (WHERE r.recommended_units > 0) AS decided_lines,
         count(*) FILTER (WHERE r.recommended_units > 0 AND d.decision_status IS NULL) AS pending_lines,
         coalesce(sum(r.recommended_units * r.unit_cost) FILTER (WHERE r.recommended_units > 0 AND d.decision_status IS NULL), 0)
           AS pending_value_at_cost,
         count(*) FILTER (WHERE d.decision_status = 'ACCEPTED') AS accepted,
         count(*) FILTER (WHERE d.decision_status = 'ADJUSTED') AS adjusted,
         count(*) FILTER (WHERE d.decision_status = 'REJECTED') AS rejected,
         count(*) FILTER (WHERE ${IS_EXCEPTION}) AS exception_lines,
         count(*) FILTER (WHERE ${IS_EXCEPTION} AND d.decision_status IS NULL) AS exception_pending,
         coalesce(sum(x.at_risk) FILTER (WHERE ${IS_EXCEPTION} AND d.decision_status IS NULL), 0) AS exception_pending_at_risk,
         count(DISTINCT r.location_id) FILTER (WHERE ${IS_EXCEPTION} AND d.decision_status IS NULL) AS exception_pending_stores,
         count(*) FILTER (WHERE ${IS_ROUTINE}) AS routine_lines,
         count(*) FILTER (WHERE ${IS_ROUTINE} AND d.decision_status IS NULL) AS routine_pending,
         coalesce(sum(r.recommended_units) FILTER (WHERE ${IS_ROUTINE} AND d.decision_status IS NULL), 0)
           AS routine_pending_units,
         coalesce(sum(r.recommended_units * r.unit_cost) FILTER (WHERE ${IS_ROUTINE} AND d.decision_status IS NULL), 0)
           AS routine_pending_value_at_cost,
         count(c.recommendation_id) AS last_year_context_lines
  ${LINES_FROM}
  WHERE ${FILTER_SQL}`;

const BY_STORE_SQL = `
  SELECT r.location_id, max(r.location_name) AS location_name, max(r.region) AS region, max(r.channel_type) AS channel_type,
         count(*) FILTER (WHERE r.stockout_risk = 'HIGH') AS needs_order,
         count(*) FILTER (WHERE r.stockout_risk = 'MEDIUM') AS safety_top_up,
         count(*) FILTER (WHERE r.recommended_units > 0 AND d.decision_status IS NULL) AS pending_lines,
         coalesce(sum(r.est_lost_sales_if_no_order) FILTER (WHERE r.stockout_risk = 'HIGH'), 0) AS needs_order_sales
  FROM serving.recommendations r
  LEFT JOIN replenishment.order_decisions d USING (recommendation_id)
  WHERE ${FILTER_SQL}
  GROUP BY r.location_id
  HAVING count(*) FILTER (WHERE r.stockout_risk = 'HIGH') > 0
  ORDER BY needs_order_sales DESC, needs_order DESC, r.location_id
  LIMIT 10`;

/** Pending routine lines in scope + filters: what "Accept all routine" will submit, line by line. */
const ROUTINE_PENDING_SQL = `
  SELECT r.recommendation_id, r.recommended_units, r.recommended_units * r.unit_cost AS value_at_cost
  ${LINES_FROM}
  WHERE ${FILTER_SQL} AND ${IS_ROUTINE} AND d.decision_status IS NULL
  ORDER BY r.recommendation_id
  LIMIT ${BULK_MAX_LINES + 1}`;

const OPTIONS_SQL = `
  SELECT DISTINCT r.location_id, r.location_name, r.region, r.channel_type, r.category
  FROM serving.recommendations r
  WHERE ${scopeSql(1)}`;

const DETAIL_SQL = `
  SELECT r.*, r.as_of_date::text AS as_of_date, c.last_year_cover_units, x.exception_reasons, x.at_risk,
         d.decision_id, d.decision_status, d.final_order_units, d.reason, d.decided_by, d.decided_at, d.version,
         d.decision_source
  ${LINES_FROM}
  WHERE r.recommendation_id = $1 AND ${scopeSql(2)}`;

const EVENTS_SQL = `
  SELECT event_id, previous_status, new_status, previous_units, new_units, reason, changed_by, changed_at, decision_source
  FROM replenishment.decision_events
  WHERE recommendation_id = $1
  ORDER BY changed_at DESC`;

const DECISION_REC_SQL = `
  SELECT r.recommended_units, r.as_of_date, r.location_id, r.sku_id, ${scopeSql(2)} AS in_scope
  FROM serving.recommendations r WHERE r.recommendation_id = $1`;

const unavailable = (err: unknown, fallback: string) =>
  servingUnavailable(err) ? 'Recommendations have not been loaded into Lakebase yet' : fallback;

/** The verified caller set by `requireUser`. */
const userOf = (res: Response): string => String(res.locals.user);

/**
 * Register the API on an Express app. Exported separately from setup so tests can mount it on a bare app with a fake
 * Lakebase and a fake token verifier. Every route requires a verified identity (401 otherwise).
 */
export function registerReplenishmentRoutes(
  app: Application,
  db: Lakebase,
  identity: IdentityOptions = defaultIdentityOptions()
) {
  const auth = requireUser(createIdentityResolver(identity));

  app.get('/api/whoami', auth, async (_req, res) => {
    const email = userOf(res);
    try {
      const scope = await resolveScope(db, email);
      res.json({
        email,
        executesAs: 'app service principal; identity verified from your forwarded token, decisions attributed to you',
        scope,
        exceptionRules: EXCEPTION_RULES,
      });
    } catch (err) {
      console.error('Failed to resolve scope:', err);
      res.status(500).json({ error: 'Failed to resolve your planning scope' });
    }
  });

  app.get('/api/filters', auth, async (_req, res) => {
    try {
      const scope = await resolveScope(db, userOf(res));
      const { rows } = await db.query(OPTIONS_SQL, scopeParams(scope));
      const stores = new Map<
        string,
        { location_id: string; location_name: string; region: string; channel_type: string }
      >();
      const categories = new Set<string>();
      const regions = new Set<string>();
      for (const r of rows) {
        const id = String(r.location_id);
        if (!stores.has(id))
          stores.set(id, {
            location_id: id,
            location_name: String(r.location_name),
            region: String(r.region),
            channel_type: String(r.channel_type),
          });
        categories.add(String(r.category));
        regions.add(String(r.region));
      }
      res.json({
        regions: [...regions].sort(),
        categories: [...categories].sort(),
        stores: [...stores.values()].sort((a, b) => a.location_name.localeCompare(b.location_name)),
        scope,
      });
    } catch (err) {
      console.error('Failed to load filters:', err);
      res.status(servingUnavailable(err) ? 503 : 500).json({ error: unavailable(err, 'Failed to load filters') });
    }
  });

  app.get('/api/recommendations/summary', auth, async (req, res) => {
    const parsed = ScopeFilters.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid filters' });
      return;
    }
    try {
      const scope = await resolveScope(db, userOf(res));
      const { rows } = await db.query(SUMMARY_SQL, filterParams(parsed.data, scope));
      res.json(rows[0]);
    } catch (err) {
      console.error('Failed to load summary:', err);
      res.status(servingUnavailable(err) ? 503 : 500).json({ error: unavailable(err, 'Failed to load summary') });
    }
  });

  app.get('/api/recommendations/by-store', auth, async (req, res) => {
    const parsed = ScopeFilters.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid filters' });
      return;
    }
    try {
      const scope = await resolveScope(db, userOf(res));
      const { rows } = await db.query(BY_STORE_SQL, filterParams(parsed.data, scope));
      res.json({ rows });
    } catch (err) {
      console.error('Failed to load stores:', err);
      res.status(servingUnavailable(err) ? 503 : 500).json({ error: unavailable(err, 'Failed to load stores') });
    }
  });

  app.get('/api/recommendations', auth, async (req, res) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid filters' });
      return;
    }
    const q = parsed.data;
    try {
      const scope = await resolveScope(db, userOf(res));
      const { rows } = await db.query(LIST_SQL, [
        ...filterParams(q, scope),
        q.risk ?? null,
        q.status ?? null,
        q.search || null,
        q.actionableOnly === 'true',
        q.peakOnly === 'true',
        q.limit,
        q.offset,
        q.segment,
      ]);
      res.json({ rows, total: rows.length > 0 ? Number(rows[0].total) : 0, limit: q.limit, offset: q.offset });
    } catch (err) {
      console.error('Failed to list recommendations:', err);
      res
        .status(servingUnavailable(err) ? 503 : 500)
        .json({ error: unavailable(err, 'Failed to list recommendations') });
    }
  });

  app.get('/api/recommendations/routine', auth, async (req, res) => {
    const parsed = ScopeFilters.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid filters' });
      return;
    }
    try {
      const scope = await resolveScope(db, userOf(res));
      const { rows } = await db.query(ROUTINE_PENDING_SQL, filterParams(parsed.data, scope));
      const lines = rows.slice(0, BULK_MAX_LINES);
      res.json({
        count: lines.length,
        truncated: rows.length > BULK_MAX_LINES,
        units: lines.reduce((sum, r) => sum + Number(r.recommended_units), 0),
        valueAtCost: lines.reduce((sum, r) => sum + Number(r.value_at_cost), 0),
        // Pending lines have no decision yet, so each is submitted expecting no prior version.
        items: lines.map((r) => ({ id: String(r.recommendation_id), expectedVersion: null })),
      });
    } catch (err) {
      console.error('Failed to list routine lines:', err);
      res.status(servingUnavailable(err) ? 503 : 500).json({ error: unavailable(err, 'Failed to list routine lines') });
    }
  });

  app.post('/api/recommendations/bulk-accept', auth, async (req, res) => {
    const parsed = BulkAcceptBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid selection' });
      return;
    }
    const user = userOf(res);
    let scope: Scope;
    try {
      scope = await resolveScope(db, user);
    } catch (err) {
      console.error('Failed to resolve scope:', err);
      res.status(500).json({ error: 'Failed to resolve your planning scope' });
      return;
    }
    try {
      const outcome = await bulkAccept(db, user, scope, parsed.data.items);
      const forbidden = outcome.results.filter((r) => r.status === 403).length;
      // 200 = every line accepted; 403 = none of the lines are in scope; 207 = some lines could not be accepted.
      const status = outcome.accepted === outcome.requested ? 200 : forbidden === outcome.requested ? 403 : 207;
      res.status(status).json(outcome);
    } catch (err) {
      console.error('Failed to bulk accept:', err);
      res.status(500).json({ error: 'Failed to save decisions; nothing was saved' });
    }
  });

  app.get('/api/recommendations/:id', auth, async (req, res) => {
    try {
      const scope = await resolveScope(db, userOf(res));
      const { rows } = await db.query(DETAIL_SQL, [req.params.id, ...scopeParams(scope)]);
      if (rows.length === 0) {
        res.status(404).json({ error: 'Recommendation not found' });
        return;
      }
      const events = await db.query(EVENTS_SQL, [req.params.id]);
      res.json({ recommendation: rows[0], events: events.rows });
    } catch (err) {
      console.error('Failed to load recommendation:', err);
      res.status(500).json({ error: 'Failed to load recommendation' });
    }
  });

  app.post('/api/recommendations/:id/decision', auth, async (req, res) => {
    const parsed = DecisionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid decision' });
      return;
    }
    const body = parsed.data;
    const user = userOf(res);
    let scope: Scope;
    try {
      scope = await resolveScope(db, user);
    } catch (err) {
      console.error('Failed to resolve scope:', err);
      res.status(500).json({ error: 'Failed to resolve your planning scope' });
      return;
    }
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const rec = await client.query(DECISION_REC_SQL, [req.params.id, ...scopeParams(scope)]);
      if (rec.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Recommendation not found' });
        return;
      }
      if (rec.rows[0].in_scope !== true) {
        await client.query('ROLLBACK');
        res.status(403).json({ error: 'This store is outside your planning scope' });
        return;
      }
      const recommended = Number(rec.rows[0].recommended_units);
      const finalUnits =
        body.status === 'ACCEPTED' ? recommended : body.status === 'REJECTED' ? 0 : (body.finalUnits ?? recommended);

      const existing = await client.query(
        `SELECT decision_id, decision_status, final_order_units, version
         FROM replenishment.order_decisions WHERE recommendation_id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const current = existing.rows[0];
      const currentVersion = current ? Number(current.version) : null;
      if (currentVersion !== body.expectedVersion) {
        await client.query('ROLLBACK');
        res.status(409).json({
          error: 'Someone else changed this order. Reload to see the latest decision.',
          currentVersion,
        });
        return;
      }

      const saved = current
        ? await client.query(
            `UPDATE replenishment.order_decisions
             SET decision_status = $2, final_order_units = $3, reason = $4, decided_by = $5,
                 decided_at = now(), updated_at = now(), version = version + 1, decision_source = $6
             WHERE recommendation_id = $1
             RETURNING *`,
            [req.params.id, body.status, finalUnits, body.reason ?? null, user, 'single']
          )
        : await client.query(
            `INSERT INTO replenishment.order_decisions
               (recommendation_id, as_of_date, location_id, sku_id, decision_status, recommended_units,
                final_order_units, reason, decided_by, decision_source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
              req.params.id,
              rec.rows[0].as_of_date,
              rec.rows[0].location_id,
              rec.rows[0].sku_id,
              body.status,
              recommended,
              finalUnits,
              body.reason ?? null,
              user,
              'single',
            ]
          );
      const decision = saved.rows[0];
      await client.query(
        `INSERT INTO replenishment.decision_events
           (decision_id, recommendation_id, previous_status, new_status, previous_units, new_units, reason, changed_by,
            decision_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          decision.decision_id,
          req.params.id,
          current?.decision_status ?? null,
          body.status,
          current ? Number(current.final_order_units) : null,
          finalUnits,
          body.reason ?? null,
          user,
          'single',
        ]
      );
      await client.query('COMMIT');
      res.status(current ? 200 : 201).json(decision);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('Failed to save decision:', err);
      res.status(500).json({ error: 'Failed to save decision' });
    } finally {
      client.release();
    }
  });
}

export interface BulkLineResult {
  id: string;
  /** 201 new decision, 200 updated decision, 403 out of scope, 404 unknown line, 409 stale version, 422 no order. */
  status: 201 | 200 | 403 | 404 | 409 | 422;
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
 * Accept many lines in one transaction, with the same rules as a single accept applied to each line: the caller's
 * scope (403), the line exists (404), it has something to order (422), and the version the client saw is still
 * current (409). Lines that pass get one decision row each (decision_source = 'bulk') and one audit event each;
 * lines that fail are reported, never silently dropped. A database error rolls everything back.
 */
export async function bulkAccept(
  db: Lakebase,
  user: string,
  scope: Scope,
  items: { id: string; expectedVersion: number | null }[]
): Promise<BulkOutcome> {
  const ids = items.map((i) => i.id);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const recs = await client.query(
      `SELECT r.recommendation_id, r.recommended_units, r.as_of_date::text AS as_of_date, r.location_id, r.sku_id,
              ${scopeSql(2)} AS in_scope
       FROM serving.recommendations r WHERE r.recommendation_id = ANY($1::text[])`,
      [ids, ...scopeParams(scope)]
    );
    const existing = await client.query(
      `SELECT decision_id, recommendation_id, decision_status, final_order_units, version
       FROM replenishment.order_decisions WHERE recommendation_id = ANY($1::text[]) FOR UPDATE`,
      [ids]
    );
    const recById = new Map(recs.rows.map((r) => [String(r.recommendation_id), r]));
    const decisionById = new Map(existing.rows.map((d) => [String(d.recommendation_id), d]));

    const results = new Map<string, BulkLineResult>();
    const inserts: Record<string, unknown>[] = [];
    const updates: { id: string; units: number; version: number; previous: Record<string, unknown> }[] = [];
    for (const item of items) {
      const rec = recById.get(item.id);
      if (!rec) {
        results.set(item.id, { id: item.id, status: 404, error: 'Recommendation not found' });
        continue;
      }
      if (rec.in_scope !== true) {
        results.set(item.id, { id: item.id, status: 403, error: 'This store is outside your planning scope' });
        continue;
      }
      const units = Number(rec.recommended_units);
      if (!(units > 0)) {
        results.set(item.id, { id: item.id, status: 422, error: 'Nothing to order on this line' });
        continue;
      }
      const current = decisionById.get(item.id);
      const currentVersion = current ? Number(current.version) : null;
      if (currentVersion !== item.expectedVersion) {
        results.set(item.id, {
          id: item.id,
          status: 409,
          error: 'Someone else changed this order. Reload to see the latest decision.',
          currentVersion,
        });
        continue;
      }
      if (current) updates.push({ id: item.id, units, version: Number(current.version), previous: current });
      else inserts.push({ ...rec, units });
    }

    const events: { decisionId: string; id: string; prevStatus: unknown; prevUnits: number | null; units: number }[] =
      [];
    if (inserts.length > 0) {
      // ON CONFLICT: a line someone else decided after we read it is a conflict for this caller, not an overwrite.
      const saved = await client.query(
        `INSERT INTO replenishment.order_decisions
           (recommendation_id, as_of_date, location_id, sku_id, decision_status, recommended_units, final_order_units,
            reason, decided_by, decision_source)
         SELECT u.id, u.as_of_date, u.location_id, u.sku_id, 'ACCEPTED', u.units, u.units, NULL, $6, 'bulk'
         FROM unnest($1::text[], $2::date[], $3::text[], $4::text[], $5::int[])
              AS u(id, as_of_date, location_id, sku_id, units)
         ON CONFLICT (recommendation_id) DO NOTHING
         RETURNING decision_id, recommendation_id, final_order_units, version`,
        [
          inserts.map((r) => r.recommendation_id),
          inserts.map((r) => r.as_of_date),
          inserts.map((r) => r.location_id),
          inserts.map((r) => r.sku_id),
          inserts.map((r) => r.units),
          user,
        ]
      );
      for (const row of saved.rows) {
        const id = String(row.recommendation_id);
        results.set(id, { id, status: 201, version: Number(row.version) });
        events.push({
          decisionId: String(row.decision_id),
          id,
          prevStatus: null,
          prevUnits: null,
          units: Number(row.final_order_units),
        });
      }
      for (const r of inserts) {
        const id = String(r.recommendation_id);
        if (!results.has(id))
          results.set(id, {
            id,
            status: 409,
            error: 'Someone else decided this order a moment ago. Reload to see it.',
            currentVersion: null,
          });
      }
    }
    if (updates.length > 0) {
      const saved = await client.query(
        `UPDATE replenishment.order_decisions d
         SET decision_status = 'ACCEPTED', final_order_units = u.units, reason = NULL, decided_by = $4,
             decided_at = now(), updated_at = now(), version = d.version + 1, decision_source = 'bulk'
         FROM unnest($1::text[], $2::int[], $3::int[]) AS u(id, units, version)
         WHERE d.recommendation_id = u.id AND d.version = u.version
         RETURNING d.decision_id, d.recommendation_id, d.final_order_units, d.version`,
        [updates.map((u) => u.id), updates.map((u) => u.units), updates.map((u) => u.version), user]
      );
      const byId = new Map(updates.map((u) => [u.id, u]));
      for (const row of saved.rows) {
        const id = String(row.recommendation_id);
        const before = byId.get(id)?.previous;
        results.set(id, { id, status: 200, version: Number(row.version) });
        events.push({
          decisionId: String(row.decision_id),
          id,
          prevStatus: before?.decision_status ?? null,
          prevUnits: before ? Number(before.final_order_units) : null,
          units: Number(row.final_order_units),
        });
      }
      for (const u of updates) {
        if (!results.has(u.id))
          results.set(u.id, { id: u.id, status: 409, error: 'Someone else changed this order.', currentVersion: null });
      }
    }
    if (events.length > 0) {
      await client.query(
        `INSERT INTO replenishment.decision_events
           (decision_id, recommendation_id, previous_status, new_status, previous_units, new_units, reason, changed_by,
            decision_source)
         SELECT e.decision_id, e.id, e.prev_status, 'ACCEPTED', e.prev_units, e.units, NULL, $6, 'bulk'
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::int[], $5::int[])
              AS e(decision_id, id, prev_status, prev_units, units)`,
        [
          events.map((e) => e.decisionId),
          events.map((e) => e.id),
          events.map((e) => e.prevStatus),
          events.map((e) => e.prevUnits),
          events.map((e) => e.units),
          user,
        ]
      );
    }
    await client.query('COMMIT');

    const ordered = items.map((i) => results.get(i.id) as BulkLineResult);
    const ok = ordered.filter((r) => r.status === 200 || r.status === 201);
    return {
      requested: items.length,
      accepted: ok.length,
      acceptedUnits: events.reduce((sum, e) => sum + e.units, 0),
      results: ordered,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function setupReplenishmentRoutes(appkit: AppKitWithLakebase) {
  try {
    for (const statement of SETUP_SQL) {
      await appkit.lakebase.query(statement);
    }
    console.log('[replenishment] Schema replenishment is ready');
    for (const row of scopeSeedRows()) await appkit.lakebase.query(SEED_SQL, row);
    console.log('[replenishment] Planner scope seed applied');
  } catch (err) {
    console.warn('[replenishment] Schema setup failed:', (err as Error).message);
  }

  if (appkit.analytics) startLineContextSync(appkit.lakebase, appkit.analytics);
  else console.warn('[replenishment] analytics plugin missing; the last-year exception rule is off');

  appkit.server.extend((app) => registerReplenishmentRoutes(app, appkit.lakebase));
}
