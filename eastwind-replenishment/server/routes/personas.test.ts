import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { IdentityOptions } from './identity';
import {
  narrowScope,
  personasEnabled,
  personasFromRows,
  ucPersonaSource,
  type PersonaSource,
  type UcGovernance,
} from './personas';
import { registerReplenishmentRoutes, type Lakebase, type PersonaOptions } from './replenishment-routes';

const ANALYST = 'analyst@eastwind.example';
const NORTH = 'north.planner@eastwind.example';
const DAAN = 'daan3.manager@eastwind.example';

const identity: IdentityOptions = {
  devUser: null,
  verifyToken: (token) => Promise.resolve(token.startsWith('tok:') ? token.slice(4) : null),
};

/** replenishment.user_scope: the signed-in users' own scopes. */
const USER_SCOPE: Record<string, { region: string | null; location_id: string | null }[]> = {
  [ANALYST]: [{ region: '*', location_id: null }],
  [NORTH]: [{ region: 'North', location_id: null }],
  [DAAN]: [{ region: null, location_id: 'L0022' }],
};

/** governance.persona_access as etl/governance/persona_rbac.sql seeds it (SERVICE rows are never selectable). */
const MAPPING = [
  ['head_office_analyst', 'Head-office Analyst', 'ANALYST', 'eastwind_head_office', '*', null, true, true, 1],
  [
    'regional_planner_north',
    'Regional Planner · North',
    'PLANNER',
    'eastwind_planners_north',
    'North',
    null,
    true,
    true,
    2,
  ],
  [
    'store_manager_l0001',
    'Store Manager · Zhongshan Shop L0001',
    'STORE_MANAGER',
    'eastwind_store_l0001',
    null,
    'L0001',
    true,
    false,
    3,
  ],
  ['auditor', 'Auditor · Read-only', 'AUDITOR', 'eastwind_auditors', '*', null, false, true, 4],
  ['svc_app', 'Replenishment app service principal', 'SERVICE', null, '*', null, false, true, 91],
].map(([persona_id, persona_label, role, uc_group, region, store_id, can_decide, sees_unit_cost, sort_order]) => ({
  persona_id,
  persona_label,
  role,
  uc_group,
  region,
  store_id,
  // The warehouse returns booleans and numbers as strings.
  can_decide: String(can_decide),
  sees_unit_cost: String(sees_unit_cost),
  sort_order: String(sort_order),
}));

const RECS = [
  { recommendation_id: 'z-1', region: 'North', location_id: 'L0001', recommended_units: 804, unit_cost: 9.5 },
  { recommendation_id: 'z-2', region: 'North', location_id: 'L0001', recommended_units: 120, unit_cost: 4 },
  { recommendation_id: 'n-1', region: 'North', location_id: 'L0021', recommended_units: 48, unit_cost: 6 },
  { recommendation_id: 'c-1', region: 'Central', location_id: 'L0022', recommended_units: 36, unit_cost: 8 },
  { recommendation_id: 's-1', region: 'South', location_id: 'L0031', recommended_units: 864, unit_cost: 2 },
];

interface Call {
  text: string;
  params: unknown[];
}

const inScope = (restricted: boolean, regions: string[], locations: string[], r: (typeof RECS)[number]) =>
  !restricted || regions.includes(r.region) || locations.includes(r.location_id);

/** In-memory Lakebase answering the statements these routes issue; every call is recorded. */
function fakeLakebase() {
  const calls: Call[] = [];
  const respond = (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (text.includes('FROM replenishment.user_scope')) return { rows: USER_SCOPE[String(params[0])] ?? [] };
    if (text.includes('SELECT DISTINCT location_id, region FROM serving.recommendations'))
      return { rows: RECS.map((r) => ({ location_id: r.location_id, region: r.region })) };
    if (text.includes('AS visible, count(*) AS total')) {
      const [restricted, regions, locations] = params as [boolean, string[], string[]];
      return {
        rows: [{ visible: RECS.filter((r) => inScope(restricted, regions, locations, r)).length, total: RECS.length }],
      };
    }
    if (text.includes('count(*) OVER ()')) {
      const [restricted, regions, locations] = params.slice(4, 7) as [boolean, string[], string[]];
      const rows = RECS.filter((r) => inScope(restricted, regions, locations, r));
      return { rows: rows.map((r) => ({ ...r, total: rows.length })) };
    }
    if (text.includes('order_value_at_cost')) return { rows: [{ store_skus: '5', order_value_at_cost: '12345.6' }] };
    if (text.includes('AS in_scope') && text.includes('ANY($1::text[])')) {
      const [ids, restricted, regions, locations] = params as [string[], boolean, string[], string[]];
      return {
        rows: RECS.filter((r) => ids.includes(r.recommendation_id)).map((r) => ({
          ...r,
          as_of_date: '2026-08-31',
          sku_id: 'SKU-1',
          in_scope: inScope(restricted, regions, locations, r),
        })),
      };
    }
    if (text.includes('AS in_scope')) {
      const [id, restricted, regions, locations] = params as [string, boolean, string[], string[]];
      const r = RECS.find((x) => x.recommendation_id === id);
      return r
        ? {
            rows: [
              { ...r, as_of_date: '2026-08-31', sku_id: 'SKU-1', in_scope: inScope(restricted, regions, locations, r) },
            ],
          }
        : { rows: [] };
    }
    if (text.includes('INSERT INTO replenishment.order_decisions') && text.includes('unnest')) {
      const ids = params[0] as string[];
      const units = params[4] as number[];
      return {
        rows: ids.map((id, i) => ({
          decision_id: `d-${id}`,
          recommendation_id: id,
          final_order_units: units[i],
          version: 1,
        })),
      };
    }
    if (text.includes('INSERT INTO replenishment.order_decisions'))
      return { rows: [{ decision_id: 'd-1', decision_status: params[4], final_order_units: params[6], version: 1 }] };
    return { rows: [] };
  };
  const db: Lakebase = {
    query: (text, params) => Promise.resolve(respond(text, params)),
    pool: {
      connect: () =>
        Promise.resolve({
          query: (text: string, params?: unknown[]) => Promise.resolve(respond(text, params)),
          release: () => {},
        }),
    },
  };
  return { db, calls };
}

const mappingSource: PersonaSource = { list: () => Promise.resolve(personasFromRows(MAPPING)) };
const ON: PersonaOptions = { enabled: true, source: mappingSource };

let server: Server | null = null;
async function start(db: Lakebase, personas: PersonaOptions = ON) {
  const app = express();
  app.use(express.json());
  registerReplenishmentRoutes(app, db, identity, personas);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

const headers = (email: string, persona?: string) => ({
  'Content-Type': 'application/json',
  'x-forwarded-access-token': `tok:${email}`,
  ...(persona ? { 'x-eastwind-persona': persona } : {}),
});

async function call(base: string, path: string, email: string, persona?: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: headers(email, persona),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const decide = (base: string, id: string, email: string, persona?: string) =>
  call(base, `/api/recommendations/${id}/decision`, email, persona, { status: 'ACCEPTED', expectedVersion: null });

const listScope = (calls: Call[]) => calls.find((c) => c.text.includes('count(*) OVER ()'))?.params.slice(4, 7);
const wrote = (calls: Call[]) => calls.some((c) => c.text.includes('INSERT') || c.text.includes('UPDATE'));

describe('"Viewing as" personas: read scope', () => {
  it('store manager L0001 sees only L0001, on the list, summary, governance count and whoami', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    const list = await call(base, '/api/recommendations', ANALYST, 'store_manager_l0001');
    expect(list.status).toBe(200);
    expect(listScope(calls)).toEqual([true, [], ['L0001']]);
    const rows = list.body.rows as { location_id: string; unit_cost: unknown }[];
    expect(rows.map((r) => r.location_id)).toEqual(['L0001', 'L0001']);
    // UC masks unit_cost for store managers; the app returns it masked too.
    expect(rows.every((r) => r.unit_cost === null)).toBe(true);

    const summary = await call(base, '/api/recommendations/summary', ANALYST, 'store_manager_l0001');
    expect(summary.body.order_value_at_cost).toBeNull();
    const who = await call(base, '/api/whoami', ANALYST, 'store_manager_l0001');
    expect(who.body).toMatchObject({
      scope: { restricted: true, locations: ['L0001'] },
      ownScope: { restricted: false },
      canDecide: true,
      costMasked: true,
      persona: { id: 'store_manager_l0001', role: 'STORE_MANAGER' },
    });
    const gov = await call(base, '/api/governance', ANALYST, 'store_manager_l0001');
    expect(gov.body.rows).toEqual({ visible: 2, total: RECS.length });
  });

  it('a persona never widens the signed-in scope: a North planner viewing as head office still sees North only', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    await call(base, '/api/recommendations', NORTH, 'head_office_analyst');
    expect(listScope(calls)).toEqual([true, ['North'], []]);
    expect((await decide(base, 's-1', NORTH, 'head_office_analyst')).status).toBe(403);
    expect(wrote(calls)).toBe(false);
  });

  it('intersects two restricted scopes, down to nothing when they do not overlap', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    await call(base, '/api/recommendations', NORTH, 'store_manager_l0001');
    expect(listScope(calls)).toEqual([true, [], ['L0001']]);
    calls.length = 0;
    // A Daan (Central, L0022) store manager viewing as the North planner: no store is in both, so nothing is visible.
    await call(base, '/api/recommendations', DAAN, 'regional_planner_north');
    expect(listScope(calls)).toEqual([true, [], []]);
    expect((await decide(base, 'c-1', DAAN, 'regional_planner_north')).status).toBe(403);
  });

  it('without a persona header the signed-in user keeps their own scope', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    await call(base, '/api/recommendations', NORTH);
    expect(listScope(calls)).toEqual([true, ['North'], []]);
    const self = await call(base, '/api/whoami', NORTH, 'self');
    expect(self.body).toMatchObject({ persona: null, canDecide: true, costMasked: false });
  });
});

describe('"Viewing as" personas: write scope', () => {
  it('store manager L0001 deciding another store (North L0021) gets 403 and nothing is written', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    const res = await decide(base, 'n-1', ANALYST, 'store_manager_l0001');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This store is outside your planning scope');
    expect(wrote(calls)).toBe(false);
  });

  it('store manager L0001 deciding its own line succeeds and records acting_persona on the decision and the event', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    const res = await decide(base, 'z-1', ANALYST, 'store_manager_l0001');
    expect(res.status).toBe(201);
    const insert = calls.find((c) => c.text.includes('INSERT INTO replenishment.order_decisions'));
    expect(insert?.text).toContain('acting_persona');
    expect(insert?.params[8]).toBe(ANALYST);
    expect(insert?.params[10]).toBe('store_manager_l0001');
    const event = calls.find((c) => c.text.includes('INSERT INTO replenishment.decision_events'));
    expect(event?.params[7]).toBe(ANALYST);
    expect(event?.params[9]).toBe('store_manager_l0001');
  });

  it('bulk accept as store manager: other stores are refused per line (207) and accepted lines carry the persona', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    const res = await call(base, '/api/recommendations/bulk-accept', ANALYST, 'store_manager_l0001', {
      items: ['z-1', 's-1', 'z-2'].map((id) => ({ id, expectedVersion: null })),
    });
    expect(res.status).toBe(207);
    expect((res.body.results as { id: string; status: number }[]).map((r) => [r.id, r.status])).toEqual([
      ['z-1', 201],
      ['s-1', 403],
      ['z-2', 201],
    ]);
    const insert = calls.find((c) => c.text.includes('INSERT INTO replenishment.order_decisions'));
    expect(insert?.params[0]).toEqual(['z-1', 'z-2']);
    expect(insert?.params[6]).toBe('store_manager_l0001');
    const event = calls.find((c) => c.text.includes('INSERT INTO replenishment.decision_events'));
    expect(event?.params[6]).toBe('store_manager_l0001');
  });

  it('auditor: every write is 403 before any transaction (single, bulk, routine)', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    const single = await decide(base, 'z-1', ANALYST, 'auditor');
    expect(single.status).toBe(403);
    expect(single.body.code).toBe('READ_ONLY_PERSONA');
    const bulk = await call(base, '/api/recommendations/bulk-accept', ANALYST, 'auditor', {
      items: [{ id: 'z-1', expectedVersion: null }],
    });
    expect(bulk.status).toBe(403);
    const routine = await call(base, '/api/recommendations/accept-routine', ANALYST, 'auditor', {
      filters: {},
      expected: { count: 1, snapshot: '0123456789abcdef' },
    });
    expect(routine.status).toBe(403);
    // Even an invalid body is refused as read-only first.
    expect((await call(base, '/api/recommendations/z-1/decision', ANALYST, 'auditor', {})).status).toBe(403);
    expect(calls.some((c) => c.text === 'BEGIN')).toBe(false);
    expect(wrote(calls)).toBe(false);
    // ...while reads still work, across every region.
    const list = await call(base, '/api/recommendations', ANALYST, 'auditor');
    expect(list.status).toBe(200);
    expect((await call(base, '/api/whoami', ANALYST, 'auditor')).body).toMatchObject({ canDecide: false });
  });

  it('records acting_persona = null when deciding in your own scope', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    expect((await decide(base, 's-1', ANALYST)).status).toBe(201);
    const insert = calls.find((c) => c.text.includes('INSERT INTO replenishment.order_decisions'));
    expect(insert?.params[10]).toBeNull();
  });
});

describe('"Viewing as" personas: validation and the DEMO_PERSONAS flag', () => {
  it('an unknown or malformed persona is 400, and nothing is read or written', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    for (const persona of ['svc_app', 'ceo', 'auditor; DROP TABLE x', 'A'.repeat(80)]) {
      const res = await call(base, '/api/recommendations', ANALYST, persona);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('UNKNOWN_PERSONA');
    }
    expect((await decide(base, 'z-1', ANALYST, 'ceo')).status).toBe(400);
    expect(calls.some((c) => c.text.includes('serving.recommendations'))).toBe(false);
    expect(wrote(calls)).toBe(false);
  });

  it('fails closed with 503 when the UC mapping cannot be read', async () => {
    const { db, calls } = fakeLakebase();
    const broken: PersonaSource = { list: () => Promise.reject(new Error('warehouse down')) };
    const base = await start(db, { enabled: true, source: broken });
    expect((await call(base, '/api/recommendations', ANALYST, 'auditor')).status).toBe(503);
    expect((await decide(base, 'z-1', ANALYST, 'store_manager_l0001')).status).toBe(503);
    expect(wrote(calls)).toBe(false);
    // The user's own view is unaffected.
    expect((await call(base, '/api/recommendations', ANALYST)).status).toBe(200);
  });

  it('flag off: the persona header is ignored (own scope, can decide, nothing recorded) and no personas are listed', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db, { enabled: false, source: mappingSource });
    await call(base, '/api/recommendations', NORTH, 'store_manager_l0001');
    expect(listScope(calls)).toEqual([true, ['North'], []]);
    // Even an unknown persona is just ignored.
    expect((await call(base, '/api/whoami', NORTH, 'ceo')).body).toMatchObject({
      persona: null,
      personasEnabled: false,
    });
    const res = await decide(base, 'n-1', NORTH, 'auditor');
    expect(res.status).toBe(201);
    const insert = calls.find((c) => c.text.includes('INSERT INTO replenishment.order_decisions'));
    expect(insert?.params[10]).toBeNull();
    expect((await call(base, '/api/personas', NORTH)).body).toEqual({ enabled: false, personas: [] });
  });

  it('personasEnabled only for DEMO_PERSONAS=true', () => {
    expect(personasEnabled({ DEMO_PERSONAS: 'true' })).toBe(true);
    for (const v of [undefined, '', 'false', '1', 'yes']) expect(personasEnabled({ DEMO_PERSONAS: v })).toBe(false);
  });

  it('lists the UC personas (no SERVICE rows) and reports the UC objects on /api/governance', async () => {
    const { db } = fakeLakebase();
    const uc: UcGovernance = {
      table: 'darren_fe_bar_catalog.gold.replenishment_recommendations_current',
      mappingTable: 'darren_fe_bar_catalog.governance.persona_access',
      rowFilter: {
        name: 'darren_fe_bar_catalog.governance.rf_store_scope',
        columns: 'region, location_id',
        definition: 'EXISTS (...)',
      },
      masks: [],
      grants: [],
      personaCounts: { store_manager_l0001: { visible: 31, total: 2247, seesUnitCost: false } },
      readAt: '2026-10-24T00:00:00Z',
    };
    const base = await start(db, { ...ON, governance: () => Promise.resolve(uc) });
    const list = await call(base, '/api/personas', ANALYST);
    expect((list.body.personas as { id: string }[]).map((p) => p.id)).toEqual([
      'head_office_analyst',
      'regional_planner_north',
      'store_manager_l0001',
      'auditor',
    ]);
    const gov = await call(base, '/api/governance', ANALYST, 'store_manager_l0001');
    expect(gov.body).toMatchObject({ uc: { rowFilter: { name: uc.rowFilter?.name } }, costMasked: true });
  });
});

describe('persona helpers', () => {
  it('personasFromRows reads the warehouse strings and groups bindings', () => {
    const personas = personasFromRows(MAPPING);
    const sm = personas.find((p) => p.id === 'store_manager_l0001');
    expect(sm).toMatchObject({
      canDecide: true,
      seesUnitCost: false,
      scope: { restricted: true, regions: [], locations: ['L0001'] },
    });
    expect(personas.find((p) => p.id === 'auditor')).toMatchObject({ canDecide: false, scope: { restricted: false } });
    expect(personas.some((p) => p.role === ('SERVICE' as string))).toBe(false);
  });

  it('narrowScope is never wider than either side', () => {
    const stores = RECS.map((r) => ({ location_id: r.location_id, region: r.region }));
    const open = { restricted: false, regions: [], locations: [] };
    const north = { restricted: true, regions: ['North'], locations: [] };
    const l1 = { restricted: true, regions: [], locations: ['L0001'] };
    expect(narrowScope(open, north, stores)).toEqual(north);
    expect(narrowScope(north, open, stores)).toEqual(north);
    expect(narrowScope(north, l1, stores)).toEqual({ restricted: true, regions: [], locations: ['L0001'] });
    expect(narrowScope(l1, north, stores)).toEqual({ restricted: true, regions: [], locations: ['L0001'] });
    expect(narrowScope({ restricted: true, regions: [], locations: [] }, open, stores).locations).toEqual([]);
  });

  it('ucPersonaSource caches the mapping and retries after a failure', async () => {
    let calls = 0;
    let fail = true;
    const source = ucPersonaSource({
      query: () => {
        calls++;
        if (fail) return Promise.reject(new Error('down'));
        return Promise.resolve({ data: MAPPING });
      },
    });
    await expect(source.list()).rejects.toThrow('down');
    fail = false;
    expect((await source.list()).length).toBe(4);
    await source.list();
    expect(calls).toBe(2);
  });
});
