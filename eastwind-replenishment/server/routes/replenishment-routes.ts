// Replenishment control-panel API.
//
// Lakebase layout (database databricks_postgres):
//   serving.recommendations         loaded from Gold by the eastwind-forecast job; read-only here
//   replenishment.order_decisions   one current decision per recommendation (app-owned)
//   replenishment.decision_events   append-only audit trail (app-owned)
//   replenishment.user_scope        which regions / stores each planner may see and decide (app-owned)
// The app's service principal creates and owns `replenishment` at startup; the load job grants it
// SELECT on `serving`.
//
// Scoping is enforced here, not in the UI: every read and write joins the caller's scope from
// replenishment.user_scope. Client filters (region, store, ...) only narrow within that scope.

import { z } from 'zod';
import type { Application, Request } from 'express';

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
];

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

/** Signed-in user from the Databricks Apps proxy; a fixed identity in local development. */
export function currentUser(req: Request): string {
  return req.header('x-forwarded-email') ?? req.header('x-forwarded-user') ?? 'local-developer';
}

export interface Scope {
  /** false = network-wide (no mapping and open mode); true = only the listed regions / stores. */
  restricted: boolean;
  regions: string[];
  locations: string[];
}

/**
 * Resolve the caller's planning scope from replenishment.user_scope. A user with mapping rows sees only those regions
 * and stores. A user without rows is network-wide in `open` mode (analysts / planners, the default) and sees
 * nothing in `strict` mode (REPLENISHMENT_SCOPE_MODE=strict).
 */
export async function resolveScope(
  db: Lakebase,
  user: string,
  mode = process.env.REPLENISHMENT_SCOPE_MODE
): Promise<Scope> {
  const { rows } = await db.query(
    'SELECT region, location_id FROM replenishment.user_scope WHERE lower(user_email) = lower($1)',
    [user]
  );
  if (rows.length === 0) {
    return mode === 'strict'
      ? { restricted: true, regions: [], locations: [] }
      : { restricted: false, regions: [], locations: [] };
  }
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

const LIST_SQL = `
  SELECT r.recommendation_id, r.as_of_date::text AS as_of_date, r.location_id, r.location_name, r.channel_type, r.region,
         r.sku_id, r.sku_name, r.category, r.peak_gift_flag, r.on_hand_units, r.inbound_units, r.recommended_units,
         r.cap_applied, r.stockout_risk, r.overstock_risk, r.est_lost_sales_if_no_order, r.est_expiry_value,
         r.explanation_text, d.decision_status, d.final_order_units, d.decided_by, d.decided_at, d.version,
         count(*) OVER () AS total
  FROM serving.recommendations r
  LEFT JOIN replenishment.order_decisions d USING (recommendation_id)
  WHERE ${FILTER_SQL}
    AND ($8::text IS NULL OR r.stockout_risk = $8)
    AND ($9::text IS NULL OR ($9 = 'PENDING' AND d.decision_status IS NULL)
         OR ($9 = 'DECIDED' AND d.decision_status IS NOT NULL) OR d.decision_status = $9)
    AND ($10::text IS NULL OR r.location_name ILIKE '%' || $10 || '%' OR r.sku_name ILIKE '%' || $10 || '%')
    AND (NOT $11::boolean OR r.recommended_units > 0 OR r.stockout_risk <> 'LOW' OR r.overstock_risk = 'HIGH')
    AND (NOT $12::boolean OR r.peak_gift_flag)
  ORDER BY CASE r.stockout_risk WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
           r.est_lost_sales_if_no_order + r.est_expiry_value DESC,
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
         count(*) FILTER (WHERE d.decision_status = 'REJECTED') AS rejected
  FROM serving.recommendations r
  LEFT JOIN replenishment.order_decisions d USING (recommendation_id)
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

const OPTIONS_SQL = `
  SELECT DISTINCT r.location_id, r.location_name, r.region, r.channel_type, r.category
  FROM serving.recommendations r
  WHERE ${scopeSql(1)}`;

const DETAIL_SQL = `
  SELECT r.*, r.as_of_date::text AS as_of_date,
         d.decision_id, d.decision_status, d.final_order_units, d.reason, d.decided_by, d.decided_at, d.version
  FROM serving.recommendations r
  LEFT JOIN replenishment.order_decisions d USING (recommendation_id)
  WHERE r.recommendation_id = $1 AND ${scopeSql(2)}`;

const EVENTS_SQL = `
  SELECT event_id, previous_status, new_status, previous_units, new_units, reason, changed_by, changed_at
  FROM replenishment.decision_events
  WHERE recommendation_id = $1
  ORDER BY changed_at DESC`;

const DECISION_REC_SQL = `
  SELECT r.recommended_units, r.as_of_date, r.location_id, r.sku_id, ${scopeSql(2)} AS in_scope
  FROM serving.recommendations r WHERE r.recommendation_id = $1`;

const unavailable = (err: unknown, fallback: string) =>
  servingUnavailable(err) ? 'Recommendations have not been loaded into Lakebase yet' : fallback;

/** Register the API on an Express app. Exported separately from setup so tests can mount it on a bare app. */
export function registerReplenishmentRoutes(app: Application, db: Lakebase) {
  app.get('/api/whoami', async (req, res) => {
    const email = currentUser(req);
    try {
      const scope = await resolveScope(db, email);
      res.json({
        email,
        executesAs: 'app service principal (decisions are attributed to the signed-in user)',
        scope,
      });
    } catch (err) {
      console.error('Failed to resolve scope:', err);
      res.status(500).json({ error: 'Failed to resolve your planning scope' });
    }
  });

  app.get('/api/filters', async (req, res) => {
    try {
      const scope = await resolveScope(db, currentUser(req));
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

  app.get('/api/recommendations/summary', async (req, res) => {
    const parsed = ScopeFilters.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid filters' });
      return;
    }
    try {
      const scope = await resolveScope(db, currentUser(req));
      const { rows } = await db.query(SUMMARY_SQL, filterParams(parsed.data, scope));
      res.json(rows[0]);
    } catch (err) {
      console.error('Failed to load summary:', err);
      res.status(servingUnavailable(err) ? 503 : 500).json({ error: unavailable(err, 'Failed to load summary') });
    }
  });

  app.get('/api/recommendations/by-store', async (req, res) => {
    const parsed = ScopeFilters.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid filters' });
      return;
    }
    try {
      const scope = await resolveScope(db, currentUser(req));
      const { rows } = await db.query(BY_STORE_SQL, filterParams(parsed.data, scope));
      res.json({ rows });
    } catch (err) {
      console.error('Failed to load stores:', err);
      res.status(servingUnavailable(err) ? 503 : 500).json({ error: unavailable(err, 'Failed to load stores') });
    }
  });

  app.get('/api/recommendations', async (req, res) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid filters' });
      return;
    }
    const q = parsed.data;
    try {
      const scope = await resolveScope(db, currentUser(req));
      const { rows } = await db.query(LIST_SQL, [
        ...filterParams(q, scope),
        q.risk ?? null,
        q.status ?? null,
        q.search || null,
        q.actionableOnly === 'true',
        q.peakOnly === 'true',
        q.limit,
        q.offset,
      ]);
      res.json({ rows, total: rows.length > 0 ? Number(rows[0].total) : 0, limit: q.limit, offset: q.offset });
    } catch (err) {
      console.error('Failed to list recommendations:', err);
      res
        .status(servingUnavailable(err) ? 503 : 500)
        .json({ error: unavailable(err, 'Failed to list recommendations') });
    }
  });

  app.get('/api/recommendations/:id', async (req, res) => {
    try {
      const scope = await resolveScope(db, currentUser(req));
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

  app.post('/api/recommendations/:id/decision', async (req, res) => {
    const parsed = DecisionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid decision' });
      return;
    }
    const body = parsed.data;
    const user = currentUser(req);
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
                 decided_at = now(), updated_at = now(), version = version + 1
             WHERE recommendation_id = $1
             RETURNING *`,
            [req.params.id, body.status, finalUnits, body.reason ?? null, user]
          )
        : await client.query(
            `INSERT INTO replenishment.order_decisions
               (recommendation_id, as_of_date, location_id, sku_id, decision_status, recommended_units,
                final_order_units, reason, decided_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
            ]
          );
      const decision = saved.rows[0];
      await client.query(
        `INSERT INTO replenishment.decision_events
           (decision_id, recommendation_id, previous_status, new_status, previous_units, new_units, reason, changed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          decision.decision_id,
          req.params.id,
          current?.decision_status ?? null,
          body.status,
          current ? Number(current.final_order_units) : null,
          finalUnits,
          body.reason ?? null,
          user,
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

export async function setupReplenishmentRoutes(appkit: AppKitWithLakebase) {
  try {
    for (const statement of SETUP_SQL) {
      await appkit.lakebase.query(statement);
    }
    console.log('[replenishment] Schema replenishment is ready');
  } catch (err) {
    console.warn('[replenishment] Schema setup failed:', (err as Error).message);
  }

  appkit.server.extend((app) => registerReplenishmentRoutes(app, appkit.lakebase));
}
