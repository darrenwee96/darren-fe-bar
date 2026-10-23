import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { IdentityOptions } from './identity';
import { EXCEPTION_RULES, exceptionReasonsSql } from './exceptions';
import { parseContextRows, refreshLineContext } from './line-context';
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
  /** No exception rule fires (what the exception SQL would compute on Lakebase). */
  routine?: boolean;
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
  { recommendation_id: 'r-1', region: 'North', location_id: 'L0001', recommended_units: 24, routine: true },
  { recommendation_id: 'r-2', region: 'North', location_id: 'L0021', recommended_units: 36, routine: true },
  { recommendation_id: 'r-3', region: 'South', location_id: 'L0031', recommended_units: 12, routine: true },
];
const EXCEPTION_IDS = ['n-1', 'n-2', 'n-3', 's-1'];

/**
 * Stateful in-memory Lakebase for the bulk path: recommendations, decisions and events live in arrays, and each SQL
 * statement the route issues is answered from them. BEGIN / COMMIT / ROLLBACK behave like a transaction: a rollback
 * restores this session's writes but keeps anything another session committed meanwhile.
 * `raceInsert` simulates another planner inserting a decision for those lines between our read and our insert
 * (ON CONFLICT DO NOTHING then skips them). `afterRoutineQuery` runs right after the routine set is computed, with an
 * `inject` that commits a decision from another session at exactly that moment.
 */
function fakeLakebase(
  opts: {
    decisions?: Decision[];
    scope?: Record<string, { region: string | null; location_id: string | null }[]>;
    raceInsert?: string[];
    afterRoutineQuery?: (inject: (d: Decision) => void) => void;
  } = {}
) {
  const decisions = [...(opts.decisions ?? [])];
  const events: unknown[][] = [];
  let snap: { decisions: Decision[]; events: number } | null = null;
  const committedElsewhere: Decision[] = [];
  const inject = (d: Decision) => {
    decisions.push(d);
    committedElsewhere.push({ ...d });
  };
  const calls: Call[] = [];
  const scope = opts.scope ?? {
    [PLANNER]: [{ region: '*', location_id: null }],
    [NORTH]: [{ region: 'North', location_id: null }],
  };
  let seq = 0;

  const respond = (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (text === 'BEGIN') snap = { decisions: decisions.map((d) => ({ ...d })), events: events.length };
    if (text === 'COMMIT') snap = null;
    if (text === 'ROLLBACK' && snap) {
      decisions.splice(0, decisions.length, ...snap.decisions, ...committedElsewhere.map((d) => ({ ...d })));
      events.length = snap.events;
      snap = null;
    }
    if (text.includes('FROM replenishment.user_scope')) return { rows: scope[String(params[0]).toLowerCase()] ?? [] };
    if (text.includes('cardinality(x.exception_reasons) = 0') && text.includes('ORDER BY r.recommendation_id')) {
      // ROUTINE_PENDING_SQL: filters ($1-$4) and scope ($5-$7) applied as the SQL does.
      const [region, , , location, restricted, regions, locations] = params as [
        string | null,
        string | null,
        string | null,
        string | null,
        boolean,
        string[],
        string[],
      ];
      const answer = {
        rows: RECS.filter(
          (r) =>
            r.routine &&
            r.recommended_units > 0 &&
            !decisions.some((d) => d.recommendation_id === r.recommendation_id) &&
            (region === null || r.region === region) &&
            (location === null || r.location_id === location) &&
            (!restricted || regions.includes(r.region) || locations.includes(r.location_id))
        ).map((r) => ({ ...r, as_of_date: '2026-08-31', value_at_cost: r.recommended_units * 10 })),
      };
      opts.afterRoutineQuery?.(inject);
      return answer;
    }
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

interface RoutineSummary {
  count: number;
  units: number;
  valueAtCost: number;
  snapshot: string;
  items?: unknown;
}

async function routineSummary(base: string, user: string, query = '') {
  const res = await fetch(`${base}/api/recommendations/routine${query}`, {
    headers: { 'x-forwarded-access-token': `tok:${user}` },
  });
  return { status: res.status, body: (await res.json()) as RoutineSummary };
}

async function acceptRoutine(base: string, body: unknown, user = PLANNER) {
  const res = await fetch(`${base}/api/recommendations/accept-routine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-access-token': `tok:${user}` },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as Outcome & { code?: string; expectedCount?: number; currentCount?: number },
  };
}

describe('GET /api/recommendations/routine', () => {
  it('summarises pending routine lines inside the caller scope and never hands out line ids', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    const res = await routineSummary(base, NORTH, '?region=North');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 2, units: 60 });
    expect(res.body.snapshot).toMatch(/^[0-9a-f]{16}$/);
    expect(res.body.items).toBeUndefined();
    const sql = calls.find((c) => c.text.includes('ORDER BY r.recommendation_id'));
    expect(sql?.text).toContain('cardinality(x.exception_reasons) = 0');
    expect(sql?.text).toContain('d.decision_status IS NULL');
    // Filters, then the server-side scope ($5-$7).
    expect(sql?.params).toEqual(['North', null, null, null, true, ['North'], []]);
  });
});

describe('POST /api/recommendations/accept-routine (server-side routine set)', () => {
  it('accepts exactly the routine set the server computes, as bulk decisions (200)', async () => {
    const { db, decisions, events } = fakeLakebase();
    const base = await start(db);
    const seen = (await routineSummary(base, PLANNER)).body;
    expect(seen.count).toBe(3);
    const res = await acceptRoutine(base, { filters: {}, expected: { count: seen.count, snapshot: seen.snapshot } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requested: 3, accepted: 3, acceptedUnits: 72 });
    expect(decisions.map((d) => d.recommendation_id).sort()).toEqual(['r-1', 'r-2', 'r-3']);
    expect(events).toHaveLength(3);
  });

  it('ignores line ids injected into the request: exception lines are never accepted through routine mode', async () => {
    const { db, decisions } = fakeLakebase();
    const base = await start(db);
    const seen = (await routineSummary(base, PLANNER)).body;
    const res = await acceptRoutine(base, {
      filters: {},
      expected: { count: seen.count, snapshot: seen.snapshot },
      items: EXCEPTION_IDS.map((id) => ({ id, expectedVersion: null })),
      ids: EXCEPTION_IDS,
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => r.id).sort()).toEqual(['r-1', 'r-2', 'r-3']);
    expect(decisions.some((d) => EXCEPTION_IDS.includes(d.recommendation_id))).toBe(false);
  });

  it('cannot widen scope: a region manager only ever accepts routine lines in their own region', async () => {
    const { db, calls, decisions } = fakeLakebase();
    const base = await start(db);
    // Asking for another region inside the caller's scope finds nothing to accept.
    const south = (await routineSummary(base, NORTH, '?region=South')).body;
    expect(south.count).toBe(0);
    // Replaying the network-wide planner's snapshot (which includes South) is refused as a changed set.
    const planner = (await routineSummary(base, PLANNER)).body;
    const replay = await acceptRoutine(
      base,
      { filters: {}, expected: { count: planner.count, snapshot: planner.snapshot } },
      NORTH
    );
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({ code: 'ROUTINE_CHANGED', expectedCount: 3, currentCount: 2 });
    expect(decisions).toHaveLength(0);
    // Their own snapshot accepts only the North routine lines, and the SQL carried their scope.
    const own = (await routineSummary(base, NORTH)).body;
    const res = await acceptRoutine(
      base,
      { filters: {}, expected: { count: own.count, snapshot: own.snapshot } },
      NORTH
    );
    expect(res.status).toBe(200);
    expect(decisions.map((d) => d.recommendation_id).sort()).toEqual(['r-1', 'r-2']);
    const routineSql = calls.filter((c) => c.text.includes('cardinality(x.exception_reasons) = 0')).reverse()[0];
    expect(routineSql?.params.slice(4)).toEqual([true, ['North'], []]);
  });

  it('reports a changed set (409) and saves nothing when the lines changed after the user looked', async () => {
    const { db, decisions, events } = fakeLakebase();
    const base = await start(db);
    const seen = (await routineSummary(base, PLANNER)).body;
    // Another planner decides r-2 in the meantime.
    decisions.push({
      decision_id: 'd-x',
      recommendation_id: 'r-2',
      decision_status: 'REJECTED',
      final_order_units: 0,
      version: 1,
    });
    const res = await acceptRoutine(base, { filters: {}, expected: { count: seen.count, snapshot: seen.snapshot } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ROUTINE_CHANGED', expectedCount: 3, currentCount: 2 });
    expect(res.body.error).toContain('Nothing was saved');
    expect(decisions).toHaveLength(1);
    expect(events).toHaveLength(0);
    // Same count but a different set (a swap) is caught by the snapshot, not only by the count.
    const swapped = await acceptRoutine(base, { filters: {}, expected: { count: 2, snapshot: seen.snapshot } });
    expect(swapped.status).toBe(409);
  });

  it('is all-or-nothing: a decision landing after the in-transaction recompute rolls everything back (409)', async () => {
    let armed = false;
    const { db, calls, decisions, events } = fakeLakebase({
      afterRoutineQuery: (inject) => {
        // Fires on the confirm request only: another planner commits a decision on r-2 between our recompute and
        // our writes.
        if (!armed) return;
        armed = false;
        inject({
          decision_id: 'd-other',
          recommendation_id: 'r-2',
          decision_status: 'REJECTED',
          final_order_units: 0,
          version: 1,
        });
      },
    });
    const base = await start(db);
    const seen = (await routineSummary(base, PLANNER)).body;
    expect(seen.count).toBe(3);
    armed = true;
    const before = calls.length;
    const res = await acceptRoutine(base, { filters: {}, expected: { count: seen.count, snapshot: seen.snapshot } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ROUTINE_CHANGED', expectedCount: 3 });
    // Zero new decisions (only the other planner's) and zero audit events from this request.
    expect(decisions.map((d) => d.recommendation_id)).toEqual(['r-2']);
    expect(events).toHaveLength(0);
    // Recompute and writes ran in ONE transaction that was rolled back, never committed.
    const tx = calls.slice(before);
    expect(tx.filter((c) => c.text === 'BEGIN')).toHaveLength(1);
    expect(tx.map((c) => c.text)).toContain('ROLLBACK');
    expect(tx.map((c) => c.text)).not.toContain('COMMIT');
    const order = tx.map((c) => c.text);
    expect(order.findIndex((t) => t.includes('cardinality(x.exception_reasons) = 0'))).toBeLessThan(
      order.findIndex((t) => t.includes('FOR UPDATE'))
    );
  });

  it('rolls back every line when a concurrent insert wins one line at write time (409, nothing saved)', async () => {
    const { db, decisions, events } = fakeLakebase({ raceInsert: ['r-3'] });
    const base = await start(db);
    const seen = (await routineSummary(base, PLANNER)).body;
    const res = await acceptRoutine(base, { filters: {}, expected: { count: seen.count, snapshot: seen.snapshot } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROUTINE_CHANGED');
    expect(decisions).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('keeps per-line partial results (207) for Accept selected', async () => {
    const decisions: Decision[] = [
      { decision_id: 'd-x', recommendation_id: 'n-2', decision_status: 'REJECTED', final_order_units: 0, version: 1 },
    ];
    const { db } = fakeLakebase({ decisions });
    const base = await start(db);
    const res = await bulk(base, { items: pending('n-1', 'n-2') });
    expect(res.status).toBe(207);
    expect(res.body.results.map((r) => r.status)).toEqual([201, 409]);
  });

  it('rejects a missing or malformed snapshot / count (400) and an unauthenticated caller (401)', async () => {
    const { db, calls } = fakeLakebase();
    const base = await start(db);
    expect((await acceptRoutine(base, { filters: {} })).status).toBe(400);
    expect((await acceptRoutine(base, { expected: { count: 0, snapshot: 'abcdefabcdefabcd' } })).status).toBe(400);
    expect((await acceptRoutine(base, { expected: { count: 3, snapshot: 'not-a-hash' } })).status).toBe(400);
    const unauth = await fetch(`${base}/api/recommendations/accept-routine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-email': PLANNER },
      body: JSON.stringify({ expected: { count: 3, snapshot: 'abcdefabcdefabcd' } }),
    });
    expect(unauth.status).toBe(401);
    expect(calls.some((c) => c.text.includes('INSERT'))).toBe(false);
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

  it('parses well-formed warehouse rows for line_context', () => {
    expect(
      parseContextRows({
        data: [
          { recommendation_id: 'a', forecast_run_id: 'run', last_year_cover_units: '42.5' },
          { recommendation_id: 'b', forecast_run_id: 'run', last_year_cover_units: null },
        ],
      })
    ).toEqual([
      { recommendation_id: 'a', forecast_run_id: 'run', last_year_cover_units: 42.5 },
      { recommendation_id: 'b', forecast_run_id: 'run', last_year_cover_units: null },
    ]);
  });

  it('rejects an empty, missing or malformed warehouse result as a whole', () => {
    expect(() => parseContextRows(undefined)).toThrow();
    expect(() => parseContextRows({})).toThrow();
    expect(() => parseContextRows({ data: [] })).toThrow();
    expect(() =>
      parseContextRows({
        data: [{ recommendation_id: 'a', last_year_cover_units: '1' }, { last_year_cover_units: '1' }],
      })
    ).toThrow(/row 1 has no recommendation_id/);
    expect(() => parseContextRows({ data: [{ recommendation_id: 'a', last_year_cover_units: 'abc' }] })).toThrow();
  });
});

describe('line_context refresh', () => {
  /** Lakebase with existing context rows; records every statement so a DELETE can be detected. */
  function contextDb() {
    let rows = [{ recommendation_id: 'old', last_year_cover_units: 10 }];
    const statements: string[] = [];
    let pending: typeof rows | null = null;
    const run = (text: string, params: unknown[] = []) => {
      statements.push(text);
      if (text === 'BEGIN') pending = [...rows];
      if (text.startsWith('DELETE FROM replenishment.line_context')) pending = [];
      if (text.includes('INSERT INTO replenishment.line_context')) {
        const [ids, , units] = params as [string[], unknown[], number[]];
        pending = [
          ...(pending ?? []),
          ...ids.map((id, i) => ({ recommendation_id: id, last_year_cover_units: units[i] })),
        ];
      }
      if (text === 'COMMIT' && pending) rows = pending;
      if (text === 'ROLLBACK') pending = null;
      return Promise.resolve({ rows: [] });
    };
    const db: Lakebase = {
      query: (t, p) => run(t, p),
      pool: { connect: () => Promise.resolve({ query: (t: string, p?: unknown[]) => run(t, p), release: () => {} }) },
    };
    return { db, statements, rows: () => rows };
  }

  it('keeps the existing rows when the warehouse returns nothing, an empty set or a malformed result', async () => {
    for (const answer of [undefined, null, {}, { data: [] }, { data: [{ forecast_run_id: 'run' }] }]) {
      const ctx = contextDb();
      await expect(refreshLineContext(ctx.db, { query: () => Promise.resolve(answer) })).rejects.toThrow();
      expect(ctx.rows()).toEqual([{ recommendation_id: 'old', last_year_cover_units: 10 }]);
      expect(ctx.statements.some((t) => t.startsWith('DELETE'))).toBe(false);
    }
  });

  it('keeps the existing rows when the warehouse call itself fails', async () => {
    const ctx = contextDb();
    await expect(
      refreshLineContext(ctx.db, { query: () => Promise.reject(new Error('warehouse down')) })
    ).rejects.toThrow('warehouse down');
    expect(ctx.rows()).toHaveLength(1);
    expect(ctx.statements).toHaveLength(0);
  });

  it('replaces the rows in one transaction when the new set is well-formed', async () => {
    const ctx = contextDb();
    const written = await refreshLineContext(ctx.db, {
      query: () =>
        Promise.resolve({ data: [{ recommendation_id: 'new', forecast_run_id: 'run', last_year_cover_units: '7' }] }),
    });
    expect(written).toBe(1);
    expect(ctx.rows()).toEqual([{ recommendation_id: 'new', last_year_cover_units: 7 }]);
    expect(ctx.statements[0]).toBe('BEGIN');
    expect(ctx.statements[ctx.statements.length - 1]).toBe('COMMIT');
  });
});
