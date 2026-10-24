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
//
// "Viewing as" personas (./personas, DEMO_PERSONAS=true): the x-eastwind-persona header picks a persona from the Unity
// Catalog mapping governance.persona_access. Its scope is intersected with the caller's own scope (never wider), a
// read-only persona gets 403 on every write, cost columns UC masks for it are nulled, and decisions and audit events
// record the persona as acting_persona.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Application, NextFunction, Request, Response } from 'express';
import { EXCEPTION_RULES, exceptionReasonsSql } from './exceptions';
import { createIdentityResolver, defaultIdentityOptions, requireUser, type IdentityOptions } from './identity';
import { startLineContextSync, type Warehouse } from './line-context';
import {
  maskCost,
  narrowScope,
  PERSONA_HEADER,
  PersonaError,
  personasEnabled,
  requestedPersona,
  ucGovernanceSource,
  ucPersonaSource,
  type Persona,
  type PersonaSource,
  type UcGovernance,
} from './personas';

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
  // v3: the "Viewing as" persona a decision was made under (NULL = the user's own scope).
  `ALTER TABLE replenishment.order_decisions ADD COLUMN IF NOT EXISTS acting_persona TEXT`,
  `ALTER TABLE replenishment.decision_events ADD COLUMN IF NOT EXISTS acting_persona TEXT`,
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
export async function resolveScope(db: Pick<Lakebase, 'query'>, user: string): Promise<Scope> {
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
         d.acting_persona, count(*) OVER () AS total
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
  SELECT r.recommendation_id, r.as_of_date::text AS as_of_date, r.recommended_units,
         r.recommended_units * r.unit_cost AS value_at_cost
  ${LINES_FROM}
  WHERE ${FILTER_SQL} AND ${IS_ROUTINE} AND d.decision_status IS NULL
  ORDER BY r.recommendation_id
  LIMIT ${BULK_MAX_LINES + 1}`;

/**
 * "Accept all routine" sends only the filters plus the count and snapshot it showed the user; the server works out the
 * routine set itself (exception rules, caller's verified scope) and never reads line ids from the client.
 */
const AcceptRoutineBody = z.object({
  filters: ScopeFilters.default({}),
  expected: z.object({
    count: z.number().int().min(1, 'There are no routine lines to accept'),
    snapshot: z.string().regex(/^[0-9a-f]{16}$/, 'Invalid routine snapshot'),
  }),
});

export interface RoutineSet {
  ids: string[];
  count: number;
  truncated: boolean;
  units: number;
  valueAtCost: number;
  /** Fingerprint of exactly which lines are routine and pending (order week + sorted ids). */
  snapshot: string;
}

/** The pending routine lines in the caller's scope + filters, computed from EXCEPTION_RULES on the server. */
export async function routineSet(
  db: Pick<Lakebase, 'query'>,
  filters: z.infer<typeof ScopeFilters>,
  scope: Scope
): Promise<RoutineSet> {
  const { rows } = await db.query(ROUTINE_PENDING_SQL, filterParams(filters, scope));
  const lines = rows.slice(0, BULK_MAX_LINES);
  const ids = lines.map((r) => String(r.recommendation_id)).sort();
  const week = lines.length > 0 ? String(lines[0].as_of_date) : '';
  return {
    ids,
    count: ids.length,
    truncated: rows.length > BULK_MAX_LINES,
    units: lines.reduce((sum, r) => sum + Number(r.recommended_units), 0),
    valueAtCost: lines.reduce((sum, r) => sum + Number(r.value_at_cost), 0),
    snapshot: createHash('sha256')
      .update(`${week}|${ids.join(',')}`)
      .digest('hex')
      .slice(0, 16),
  };
}

const OPTIONS_SQL = `
  SELECT DISTINCT r.location_id, r.location_name, r.region, r.channel_type, r.category
  FROM serving.recommendations r
  WHERE ${scopeSql(1)}`;

const DETAIL_SQL = `
  SELECT r.*, r.as_of_date::text AS as_of_date, c.last_year_cover_units, x.exception_reasons, x.at_risk,
         d.decision_id, d.decision_status, d.final_order_units, d.reason, d.decided_by, d.decided_at, d.version,
         d.decision_source, d.acting_persona
  ${LINES_FROM}
  WHERE r.recommendation_id = $1 AND ${scopeSql(2)}`;

const EVENTS_SQL = `
  SELECT event_id, previous_status, new_status, previous_units, new_units, reason, changed_by, changed_at, decision_source,
         acting_persona
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

/** What the caller may see and do on this request: their own scope, narrowed by the persona they are viewing as. */
export interface Access {
  /** Effective read and write scope. */
  scope: Scope;
  /** The caller's own scope from replenishment.user_scope. */
  own: Scope;
  canDecide: boolean;
  persona: Persona | null;
  /** UC masks unit cost for this persona: cost columns and values derived from them are nulled. */
  costMasked: boolean;
}

const accessOf = (res: Response): Access => res.locals.access as Access;

export interface PersonaOptions {
  /** DEMO_PERSONAS=true: honour the x-eastwind-persona header. Off = the header is ignored. */
  enabled: boolean;
  source: PersonaSource | null;
  /** Live UC metadata for the governance panel. */
  governance?: (() => Promise<UcGovernance>) | null;
}

const STORES_SQL = 'SELECT DISTINCT location_id, region FROM serving.recommendations';

const VISIBLE_SQL = `
  SELECT count(*) FILTER (WHERE ${scopeSql(1)}) AS visible, count(*) AS total
  FROM serving.recommendations r`;

/** Resolve the caller's access for this request. Throws PersonaError (400 / 503) for a bad or unreadable persona. */
export async function resolveAccess(
  db: Pick<Lakebase, 'query'>,
  user: string,
  personaHeader: string | undefined,
  personas: PersonaOptions
): Promise<Access> {
  const own = await resolveScope(db, user);
  const id = requestedPersona(personaHeader, personas.enabled);
  if (!id) return { scope: own, own, canDecide: true, persona: null, costMasked: false };
  if (!personas.source) throw new PersonaError('Personas are not available', 503, 'PERSONAS_UNAVAILABLE');
  let list: Persona[];
  try {
    list = await personas.source.list();
  } catch (err) {
    console.error('Failed to read the persona mapping from Unity Catalog:', err);
    throw new PersonaError(
      'The governed persona mapping could not be read. Switch back to your own view or try again.',
      503,
      'PERSONAS_UNAVAILABLE'
    );
  }
  const persona = list.find((p) => p.id === id);
  if (!persona) throw new PersonaError('Unknown persona', 400, 'UNKNOWN_PERSONA');
  const stores =
    own.restricted && persona.scope.restricted
      ? (await db.query(STORES_SQL)).rows.map((r) => ({ location_id: String(r.location_id), region: String(r.region) }))
      : [];
  return {
    scope: narrowScope(own, persona.scope, stores),
    own,
    canDecide: persona.canDecide,
    persona,
    costMasked: !persona.seesUnitCost,
  };
}

/** 403 for a read-only persona, before any write is attempted. Returns true when the request was refused. */
function refuseReadOnly(res: Response): boolean {
  const access = accessOf(res);
  if (access.canDecide) return false;
  res.status(403).json({
    error: `${access.persona?.label ?? 'This view'} is read-only: you can see these order lines but not decide them.`,
    code: 'READ_ONLY_PERSONA',
  });
  return true;
}

const personaOf = (res: Response): string | null => accessOf(res).persona?.id ?? null;

/**
 * Register the API on an Express app. Exported separately from setup so tests can mount it on a bare app with a fake
 * Lakebase and a fake token verifier. Every route requires a verified identity (401 otherwise).
 */
export function registerReplenishmentRoutes(
  app: Application,
  db: Lakebase,
  identity: IdentityOptions = defaultIdentityOptions(),
  personas: PersonaOptions = { enabled: false, source: null }
) {
  const verify = requireUser(createIdentityResolver(identity));
  /** After `verify`: the caller's scope (own, narrowed by the persona) as res.locals.access, or 400 / 5xx. */
  const withAccess = (req: Request, res: Response, next: NextFunction) => {
    resolveAccess(db, userOf(res), req.header(PERSONA_HEADER), personas)
      .then((access) => {
        res.locals.access = access;
        next();
      })
      .catch((err: unknown) => {
        if (err instanceof PersonaError) {
          res.status(err.status).json({ error: err.message, code: err.code });
          return;
        }
        console.error('Failed to resolve scope:', err);
        res
          .status(servingUnavailable(err) ? 503 : 500)
          .json({ error: unavailable(err, 'Failed to resolve your planning scope') });
      });
  };

  app.get('/api/whoami', verify, withAccess, (_req, res) => {
    const access = accessOf(res);
    res.json({
      email: userOf(res),
      executesAs: 'app service principal; identity verified from your forwarded token, decisions attributed to you',
      scope: access.scope,
      ownScope: access.own,
      canDecide: access.canDecide,
      costMasked: access.costMasked,
      persona: access.persona,
      personasEnabled: personas.enabled,
      exceptionRules: EXCEPTION_RULES,
    });
  });

  /** The selectable personas from the UC mapping (empty when DEMO_PERSONAS is off). */
  app.get('/api/personas', verify, async (_req, res) => {
    if (!personas.enabled || !personas.source) {
      res.json({ enabled: false, personas: [] });
      return;
    }
    try {
      res.json({ enabled: true, personas: await personas.source.list() });
    } catch (err) {
      console.error('Failed to read the persona mapping from Unity Catalog:', err);
      res.status(503).json({ error: 'The governed persona mapping could not be read', code: 'PERSONAS_UNAVAILABLE' });
    }
  });

  /** Governance panel: the effective access, rows visible vs total, and the UC objects that enforce it (live). */
  app.get('/api/governance', verify, withAccess, async (_req, res) => {
    const access = accessOf(res);
    try {
      const { rows } = await db.query(VISIBLE_SQL, scopeParams(access.scope));
      let uc: UcGovernance | null = null;
      let ucError: string | null = null;
      if (personas.governance) {
        try {
          uc = await personas.governance();
        } catch (err) {
          console.error('Failed to read UC governance metadata:', err);
          ucError = 'Unity Catalog metadata could not be read right now';
        }
      }
      res.json({
        persona: access.persona,
        scope: access.scope,
        ownScope: access.own,
        canDecide: access.canDecide,
        costMasked: access.costMasked,
        rows: { visible: Number(rows[0]?.visible ?? 0), total: Number(rows[0]?.total ?? 0) },
        uc,
        ucError,
      });
    } catch (err) {
      console.error('Failed to load governance:', err);
      res.status(servingUnavailable(err) ? 503 : 500).json({ error: unavailable(err, 'Failed to load governance') });
    }
  });

  app.get('/api/filters', verify, withAccess, async (_req, res) => {
    try {
      const { scope } = accessOf(res);
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

  app.get('/api/recommendations/summary', verify, withAccess, async (req, res) => {
    const parsed = ScopeFilters.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid filters' });
      return;
    }
    try {
      const { scope, costMasked } = accessOf(res);
      const { rows } = await db.query(SUMMARY_SQL, filterParams(parsed.data, scope));
      res.json(maskCost(rows[0], costMasked));
    } catch (err) {
      console.error('Failed to load summary:', err);
      res.status(servingUnavailable(err) ? 503 : 500).json({ error: unavailable(err, 'Failed to load summary') });
    }
  });

  app.get('/api/recommendations/by-store', verify, withAccess, async (req, res) => {
    const parsed = ScopeFilters.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid filters' });
      return;
    }
    try {
      const { scope } = accessOf(res);
      const { rows } = await db.query(BY_STORE_SQL, filterParams(parsed.data, scope));
      res.json({ rows });
    } catch (err) {
      console.error('Failed to load stores:', err);
      res.status(servingUnavailable(err) ? 503 : 500).json({ error: unavailable(err, 'Failed to load stores') });
    }
  });

  app.get('/api/recommendations', verify, withAccess, async (req, res) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid filters' });
      return;
    }
    const q = parsed.data;
    try {
      const { scope, costMasked } = accessOf(res);
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
      res.json({
        rows: rows.map((r) => maskCost(r, costMasked)),
        total: rows.length > 0 ? Number(rows[0].total) : 0,
        limit: q.limit,
        offset: q.offset,
      });
    } catch (err) {
      console.error('Failed to list recommendations:', err);
      res
        .status(servingUnavailable(err) ? 503 : 500)
        .json({ error: unavailable(err, 'Failed to list recommendations') });
    }
  });

  app.get('/api/recommendations/routine', verify, withAccess, async (req, res) => {
    const parsed = ScopeFilters.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid filters' });
      return;
    }
    try {
      const { scope, costMasked } = accessOf(res);
      const set = await routineSet(db, parsed.data, scope);
      // Counts + snapshot only: the ids stay on the server, which recomputes them when the user confirms.
      res.json({
        count: set.count,
        truncated: set.truncated,
        units: set.units,
        valueAtCost: costMasked ? null : set.valueAtCost,
        snapshot: set.snapshot,
      });
    } catch (err) {
      console.error('Failed to list routine lines:', err);
      res.status(servingUnavailable(err) ? 503 : 500).json({ error: unavailable(err, 'Failed to list routine lines') });
    }
  });

  app.post('/api/recommendations/accept-routine', verify, withAccess, async (req, res) => {
    if (refuseReadOnly(res)) return;
    const parsed = AcceptRoutineBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
      return;
    }
    const { filters, expected } = parsed.data;
    const user = userOf(res);
    try {
      const { scope } = accessOf(res);
      const result = await acceptRoutineSet(db, user, scope, filters, expected, personaOf(res));
      if (result.ok) {
        res.status(200).json(result.outcome);
      } else if (result.reason === 'truncated') {
        res.status(400).json({ error: `More than ${BULK_MAX_LINES} routine lines; narrow the filters first` });
      } else {
        // The data changed since the user confirmed (a reload, someone else's decision, a new rule result), or a line
        // could not be accepted at write time: everything was rolled back rather than accepting a different set.
        res.status(409).json({
          error: `The routine lines changed since you looked (you saw ${expected.count}, there are now ${result.currentCount}). Nothing was saved; review and try again.`,
          code: 'ROUTINE_CHANGED',
          expectedCount: expected.count,
          currentCount: result.currentCount,
        });
      }
    } catch (err) {
      console.error('Failed to accept routine lines:', err);
      res.status(500).json({ error: 'Failed to save decisions; nothing was saved' });
    }
  });

  app.post('/api/recommendations/bulk-accept', verify, withAccess, async (req, res) => {
    if (refuseReadOnly(res)) return;
    const parsed = BulkAcceptBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid selection' });
      return;
    }
    const user = userOf(res);
    const { scope } = accessOf(res);
    try {
      const outcome = await bulkAccept(db, user, scope, parsed.data.items, personaOf(res));
      const forbidden = outcome.results.filter((r) => r.status === 403).length;
      // 200 = every line accepted; 403 = none of the lines are in scope; 207 = some lines could not be accepted.
      const status = outcome.accepted === outcome.requested ? 200 : forbidden === outcome.requested ? 403 : 207;
      res.status(status).json(outcome);
    } catch (err) {
      console.error('Failed to bulk accept:', err);
      res.status(500).json({ error: 'Failed to save decisions; nothing was saved' });
    }
  });

  app.get('/api/recommendations/:id', verify, withAccess, async (req, res) => {
    try {
      const { scope, costMasked } = accessOf(res);
      const { rows } = await db.query(DETAIL_SQL, [req.params.id, ...scopeParams(scope)]);
      if (rows.length === 0) {
        res.status(404).json({ error: 'Recommendation not found' });
        return;
      }
      const events = await db.query(EVENTS_SQL, [req.params.id]);
      res.json({ recommendation: maskCost(rows[0], costMasked), events: events.rows });
    } catch (err) {
      console.error('Failed to load recommendation:', err);
      res.status(500).json({ error: 'Failed to load recommendation' });
    }
  });

  app.post('/api/recommendations/:id/decision', verify, withAccess, async (req, res) => {
    if (refuseReadOnly(res)) return;
    const parsed = DecisionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid decision' });
      return;
    }
    const body = parsed.data;
    const user = userOf(res);
    const { scope } = accessOf(res);
    const persona = personaOf(res);
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
                 decided_at = now(), updated_at = now(), version = version + 1, decision_source = $6,
                 acting_persona = $7
             WHERE recommendation_id = $1
             RETURNING *`,
            [req.params.id, body.status, finalUnits, body.reason ?? null, user, 'single', persona]
          )
        : await client.query(
            `INSERT INTO replenishment.order_decisions
               (recommendation_id, as_of_date, location_id, sku_id, decision_status, recommended_units,
                final_order_units, reason, decided_by, decision_source, acting_persona)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
              persona,
            ]
          );
      const decision = saved.rows[0];
      await client.query(
        `INSERT INTO replenishment.decision_events
           (decision_id, recommendation_id, previous_status, new_status, previous_units, new_units, reason, changed_by,
            decision_source, acting_persona)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
          persona,
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
  items: { id: string; expectedVersion: number | null }[],
  persona: string | null = null
): Promise<BulkOutcome> {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await acceptLines(client, user, scope, items, persona);
    await client.query('COMMIT');
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** The per-line accept logic, run on a client that already holds an open transaction (the caller commits). */
async function acceptLines(
  client: PoolClient,
  user: string,
  scope: Scope,
  items: { id: string; expectedVersion: number | null }[],
  persona: string | null
): Promise<BulkOutcome> {
  const ids = items.map((i) => i.id);
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

  const events: { decisionId: string; id: string; prevStatus: unknown; prevUnits: number | null; units: number }[] = [];
  if (inserts.length > 0) {
    // ON CONFLICT: a line someone else decided after we read it is a conflict for this caller, not an overwrite.
    const saved = await client.query(
      `INSERT INTO replenishment.order_decisions
         (recommendation_id, as_of_date, location_id, sku_id, decision_status, recommended_units, final_order_units,
          reason, decided_by, decision_source, acting_persona)
       SELECT u.id, u.as_of_date, u.location_id, u.sku_id, 'ACCEPTED', u.units, u.units, NULL, $6, 'bulk', $7
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
        persona,
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
           decided_at = now(), updated_at = now(), version = d.version + 1, decision_source = 'bulk',
           acting_persona = $5
       FROM unnest($1::text[], $2::int[], $3::int[]) AS u(id, units, version)
       WHERE d.recommendation_id = u.id AND d.version = u.version
       RETURNING d.decision_id, d.recommendation_id, d.final_order_units, d.version`,
      [updates.map((u) => u.id), updates.map((u) => u.units), updates.map((u) => u.version), user, persona]
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
          decision_source, acting_persona)
       SELECT e.decision_id, e.id, e.prev_status, 'ACCEPTED', e.prev_units, e.units, NULL, $6, 'bulk', $7
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::int[], $5::int[])
            AS e(decision_id, id, prev_status, prev_units, units)`,
      [
        events.map((e) => e.decisionId),
        events.map((e) => e.id),
        events.map((e) => e.prevStatus),
        events.map((e) => e.prevUnits),
        events.map((e) => e.units),
        user,
        persona,
      ]
    );
  }
  const ordered = items.map((i) => results.get(i.id) as BulkLineResult);
  const ok = ordered.filter((r) => r.status === 200 || r.status === 201);
  return {
    requested: items.length,
    accepted: ok.length,
    acceptedUnits: events.reduce((sum, e) => sum + e.units, 0),
    results: ordered,
  };
}

export type RoutineAcceptResult =
  | { ok: true; outcome: BulkOutcome }
  | { ok: false; reason: 'changed' | 'truncated'; currentCount: number };

/**
 * Accept all routine, all or nothing, in ONE transaction on one connection: recompute the pending routine set inside
 * the caller's scope, compare it with the count + snapshot the user confirmed, then write every decision and audit
 * event. Any difference, or any line that cannot be accepted (someone decided it after the recompute, it left scope),
 * rolls the whole transaction back, so the caller gets 409 and nothing is saved, never a partial commit.
 *
 * Pending lines have no order_decisions row to lock. A decision that lands concurrently is still caught inside the
 * transaction: either it is visible to the per-line read of existing decisions, or our INSERT hits the unique
 * recommendation_id (ON CONFLICT DO NOTHING waits for the other transaction) and that line comes back as a conflict.
 */
export async function acceptRoutineSet(
  db: Lakebase,
  user: string,
  scope: Scope,
  filters: z.infer<typeof ScopeFilters>,
  expected: { count: number; snapshot: string },
  persona: string | null = null
): Promise<RoutineAcceptResult> {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const current = await routineSet(client, filters, scope);
    if (current.truncated) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'truncated', currentCount: current.count };
    }
    if (current.snapshot !== expected.snapshot || current.count !== expected.count) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'changed', currentCount: current.count };
    }
    const outcome = await acceptLines(
      client,
      user,
      scope,
      current.ids.map((id) => ({ id, expectedVersion: null })),
      persona
    );
    if (outcome.accepted !== outcome.requested) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'changed', currentCount: outcome.accepted };
    }
    await client.query('COMMIT');
    return { ok: true, outcome };
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

  const enabled = personasEnabled();
  const warehouse = appkit.analytics;
  const personas: PersonaOptions = {
    enabled,
    source: enabled && warehouse ? ucPersonaSource(warehouse) : null,
    governance: enabled && warehouse ? ucGovernanceSource(warehouse) : null,
  };
  console.log(`[replenishment] "Viewing as" personas ${enabled ? 'enabled (DEMO_PERSONAS=true)' : 'off'}`);
  appkit.server.extend((app) => registerReplenishmentRoutes(app, appkit.lakebase, defaultIdentityOptions(), personas));
}
