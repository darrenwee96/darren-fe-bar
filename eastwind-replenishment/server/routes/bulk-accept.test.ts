import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { IdentityOptions } from './identity';
import { EXCEPTION_RULES, exceptionReasonsSql } from './exceptions';
import { parseContextRows } from './line-context';
import { registerReplenishmentRoutes, type Lakebase } from './replenishment-routes';

const PLANNER = 'planner@eastwind.example';
const NORTH = 'north.manager@eastwind.example';

const identity: IdentityOptions = {
  devUser: null,
  verifyToken: (token) => Promise.resolve(token.startsWith('tok:') ? token.slice(4) : null),
};

interface Rec {
  recommendation_id: string;
  region: string;
  location_id: string;
  recommended_units: number;
}
interface Decision {
  decision_id: string;
  recommendation_id: string;
  decision_status: string;
  final_order_units: number;
  version: number;
}
interface Call {
  text: string;
  params: unknown[];
}

const RECS: Rec[] = [
  { recommendation_id: 'n-1', region: 'North', location_id: 'L0001', recommended_units: 804 },
  { recommendation_id: 'n-2', region: 'North', location_id: 'L0001', recommended_units: 120 },
  { recommendation_id: 'n-3', region: 'North', location_id: 'L0021', recommended_units: 48 },
  { recommendation_id: 's-1', region: 'South', location_id: 'L0031', recommended_units: 864 },
  { recommendation_id: 'z-0', region: 'North', location_id: 'L0021', recommended_units: 0 },
];

/**
 * Stateful in-memory Lakebase for the bulk path: recommendations, decisions and events live in arrays, and each SQL
 * statement the route issues is answered from them. `raceInsert` simulates another planner inserting a decision for
 * those lines between our read and our insert (ON CONFLICT DO NOTHING then skips them).
 */
function fakeLakebase(
  opts: {
    decisions?: Decision[];
    scope?: Record<string, { region: string | null; location_id: string | null }[]>;
    raceInsert?: string[];
  } = {}
) {
  const decisions = [...(opts.decisions ?? [])];
  const events: unknown[][] = [];
  const calls: Call[] = [];
  const scope = opts.scope ?? {
    [PLANNER]: [{ region: '*', location_id: null }],
    [NORTH]: [{ region: 'North', location_id: null }],
  };
  let seq = 0;

  const respond = (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (text.includes('FROM replenishment.user_scope')) return { rows: scope[String(params[0]).toLowerCase()] ?? [] };
    if (text.includes('AS in_scope') && text.includes('ANY($1::text[])')) {
      const [ids, restricted, regions, locations] = params as [string[], boolean, string[], string[]];
      return {
        rows: RECS.filter((r) => ids.includes(r.recommendation_id)).map((r) => ({
          ...r,
          as_of_date: '2026-08-31',
          sku_id: 'SKU-MC01',
          in_scope: !restricted || regions.includes(r.region) || locations.includes(r.location_id),
        })),
      };
    }
    if (text.includes('FOR UPDATE')) {
      const ids = params[0] as string[];
      return { rows: decisions.filter((d) => ids.includes(d.recommendation_id)).map((d) => ({ ...d })) };
    }
    if (text.includes('INSERT INTO replenishment.order_decisions')) {
      const [ids, , , , units] = params as [string[], string[], string[], string[], number[]];
      const rows: Decision[] = [];
      ids.forEach((id, i) => {
        if (opts.raceInsert?.includes(id) || decisions.some((d) => d.recommendation_id === id)) return;
        const d = {
          decision_id: `d-${++seq}`,
          recommendation_id: id,
          decision_status: 'ACCEPTED',
          final_order_units: units[i],
          version: 1,
        };
        decisions.push(d);
        rows.push(d);
      });
      return { rows };
    }
    if (text.includes('UPDATE replenishment.order_decisions d')) {
      const [ids, units, versions] = params as [string[], number[], number[]];
      const rows: Decision[] = [];
      ids.forEach((id, i) => {
        const d = decisions.find((x) => x.recommendation_id === id && x.version === versions[i]);
        if (!d) return;
        Object.assign(d, { decision_status: 'ACCEPTED', final_order_units: units[i], version: d.version + 1 });
        rows.push({ ...d });
      });
      return { rows };
    }
    if (text.includes('INSERT INTO replenishment.decision_events')) {
      const [decisionIds, ids, prevStatus, prevUnits, units, user] = params as [
        string[],
        string[],
        (string | null)[],
        (number | null)[],
        number[],
        string,
      ];
      decisionIds.forEach((_, i) => events.push([decisionIds[i], ids[i], prevStatus[i], prevUnits[i], units[i], user]));
      return { rows: [] };
    }
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
  return { db, calls, decisions, events };
}

let server: Server | null = null;
async function start(db: Lakebase) {
  const app = express();
  app.use(express.json());
  registerReplenishmentRoutes(app, db, identity);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

interface Outcome {
  requested: number;
  accepted: number;
  acceptedUnits: number;
  results: { id: string; status: number; currentVersion?: number | null }[];
  error?: string;
}

async function bulk(
  base: string,
  body: unknown,
  headers: Record<string, string> = { 'x-forwarded-access-token': `tok:${PLANNER}` }
) {
  const res = await fetch(`${base}/api/recommendations/bulk-accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Outcome };
}

const pending = (...ids: string[]) => ids.map((id) => ({ id, expectedVersion: null }));

describe('POST /api/recommendations/bulk-accept', () => {
  it('accepts every line in one transaction with one decision row and one audit event per line (200)', async () => {
    const { db, calls, decisions, events } = fakeLakebase();
    const base = await start(db);
    const res = await bulk(base, { items: pending('n-1', 'n-2', 's-1') });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requested: 3, accepted: 3, acceptedUnits: 804 + 120 + 864 });
    expect(res.body.results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(decisions.map((d) => [d.recommendation_id, d.final_order_units])).toEqual([
      ['n-1', 804],
      ['n-2', 120],
      ['s-1', 864],
    ]);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e[5] === PLANNER)).toBe(true);
    const texts = calls.map((c) => c.text);
    expect(texts.filter((t) => t === 'BEGIN')).toHaveLength(1);
    expect(texts).toContain('COMMIT');
    // Recorded as a bulk decision under the verified identity.
    const insert = calls.find((c) => c.text.includes('INSERT INTO replenishment.order_decisions'));
    expect(insert?.text).toContain("'bulk'");
    expect(insert?.params[5]).toBe(PLANNER);
  });

  it('refuses out-of-scope lines per line (403) and still accepts the in-scope ones (207)', async () => {
    const { db, decisions } = fakeLakebase();
    const base = await start(db);
    const res = await bulk(
      base,
      { items: pending('n-1', 's-1', 'n-3') },
      { 'x-forwarded-access-token': `tok:${NORTH}` }
    );
    expect(res.status).toBe(207);
    expect(res.body.accepted).toBe(2);
    expect(res.body.results).toEqual([
      { id: 'n-1', status: 201, version: 1 },
      expect.objectContaining({ id: 's-1', status: 403 }),
      { id: 'n-3', status: 201, version: 1 },
    ]);
    expect(decisions.some((d) => d.recommendation_id === 's-1')).toBe(false);
  });

  it('returns 403 and writes nothing when no line is in scope (fail-closed for an unmapped user)', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    const res = await bulk(
      base,
      { items: pending('n-1', 's-1') },
      { 'x-forwarded-access-token': 'tok:stranger@eastwind.example' }
    );
    expect(res.status).toBe(403);
    expect(res.body.results.every((r) => r.status === 403)).toBe(true);
    expect(calls.some((c) => c.text.includes('INSERT'))).toBe(false);
  });

  it('reports version conflicts on some lines (409 per line) and accepts the rest', async () => {
    const decisions: Decision[] = [
      // Someone already decided n-2: the client still expects no decision.
      { decision_id: 'd-x', recommendation_id: 'n-2', decision_status: 'REJECTED', final_order_units: 0, version: 1 },
      // n-3 was decided at version 2; the client saw version 1.
      { decision_id: 'd-y', recommendation_id: 'n-3', decision_status: 'ADJUSTED', final_order_units: 40, version: 2 },
    ];
    const { db, events } = fakeLakebase({ decisions, raceInsert: ['s-1'] });
    const base = await start(db);
    const res = await bulk(base, {
      items: [
        { id: 'n-1', expectedVersion: null },
        { id: 'n-2', expectedVersion: null },
        { id: 'n-3', expectedVersion: 1 },
        { id: 's-1', expectedVersion: null },
      ],
    });
    expect(res.status).toBe(207);
    expect(res.body.accepted).toBe(1);
    expect(res.body.results.map((r) => [r.id, r.status, r.currentVersion])).toEqual([
      ['n-1', 201, undefined],
      ['n-2', 409, 1],
      ['n-3', 409, 2],
      // Decided by someone else between our read and our insert: a conflict, not an overwrite.
      ['s-1', 409, null],
    ]);
    expect(decisions.find((d) => d.recommendation_id === 'n-2')?.decision_status).toBe('REJECTED');
    expect(events).toHaveLength(1);
  });

  it('re-accepts a decided line when the expected version is current, bumping the version (200)', async () => {
    const decisions: Decision[] = [
      { decision_id: 'd-x', recommendation_id: 'n-1', decision_status: 'ADJUSTED', final_order_units: 600, version: 2 },
    ];
    const { db, events } = fakeLakebase({ decisions });
    const base = await start(db);
    const res = await bulk(base, { items: [{ id: 'n-1', expectedVersion: 2 }] });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([{ id: 'n-1', status: 200, version: 3 }]);
    expect(events[0].slice(1, 5)).toEqual(['n-1', 'ADJUSTED', 600, 804]);
  });

  it('reports unknown lines (404) and lines with nothing to order (422)', async () => {
    const { db } = fakeLakebase();
    const base = await start(db);
    const res = await bulk(base, { items: pending('n-1', 'nope', 'z-0') });
    expect(res.status).toBe(207);
    expect(res.body.results.map((r) => r.status)).toEqual([201, 404, 422]);
  });

  it('rejects an empty selection, duplicates and malformed items with 400 before opening a transaction', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    const empty = await bulk(base, { items: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('Select at least one order line');
    expect((await bulk(base, { items: pending('n-1', 'n-1') })).status).toBe(400);
    expect((await bulk(base, {})).status).toBe(400);
    expect((await bulk(base, { items: [{ id: 'n-1', expectedVersion: 0 }] })).status).toBe(400);
    expect(calls.some((c) => c.text === 'BEGIN')).toBe(false);
  });

  it('returns 401 without a verifiable identity and never touches Lakebase', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    expect((await bulk(base, { items: pending('n-1') }, { 'x-forwarded-email': PLANNER })).status).toBe(401);
    expect((await bulk(base, { items: pending('n-1') }, { 'x-forwarded-access-token': 'bad-token' })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe('GET /api/recommendations/routine', () => {
  it('lists pending routine lines inside the caller scope for "Accept all routine"', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    const res = await fetch(`${base}/api/recommendations/routine?region=North`, {
      headers: { 'x-forwarded-access-token': `tok:${NORTH}` },
    });
    expect(res.status).toBe(200);
    const sql = calls.find((c) => c.text.includes('ORDER BY r.recommendation_id'));
    expect(sql?.text).toContain('cardinality(x.exception_reasons) = 0');
    expect(sql?.text).toContain('d.decision_status IS NULL');
    // Filters, then the server-side scope ($5-$7).
    expect(sql?.params).toEqual(['North', null, null, null, true, ['North'], []]);
  });
});

describe('exception rules', () => {
  it('builds the rule SQL from the one config constant', () => {
    const text = exceptionReasonsSql();
    for (const reason of ['PEAK_STOCKOUT', 'SHELF_CAP', 'VS_LAST_YEAR', 'VS_RECENT', 'HIGH_VALUE'])
      expect(text).toContain(`'${reason}'`);
    expect(text).toContain(`>= ${EXCEPTION_RULES.peakSalesAtRisk}`);
    expect(text).toContain(`>= ${EXCEPTION_RULES.highOrderValue}`);
    expect(() => exceptionReasonsSql({ ...EXCEPTION_RULES, highOrderValue: Number.NaN })).toThrow();
  });

  it('parses warehouse rows for line_context, skipping rows without an id', () => {
    expect(
      parseContextRows({
        data: [
          { recommendation_id: 'a', forecast_run_id: 'run', last_year_cover_units: '42.5' },
          { recommendation_id: 'b', forecast_run_id: 'run', last_year_cover_units: null },
          { forecast_run_id: 'run', last_year_cover_units: '1' },
        ],
      })
    ).toEqual([
      { recommendation_id: 'a', forecast_run_id: 'run', last_year_cover_units: 42.5 },
      { recommendation_id: 'b', forecast_run_id: 'run', last_year_cover_units: null },
    ]);
    expect(parseContextRows(undefined)).toEqual([]);
  });
});
