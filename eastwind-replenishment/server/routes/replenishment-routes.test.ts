import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { registerReplenishmentRoutes, resolveScope, type Lakebase } from './replenishment-routes';

interface Call {
  text: string;
  params: unknown[];
}

interface FakeState {
  /** replenishment.user_scope rows per user email. */
  scope?: Record<string, { region: string | null; location_id: string | null }[]>;
  /** serving.recommendations row for the decision, or null when it does not exist. */
  rec?: { recommended_units: number; region: string; location_id: string } | null;
  /** Current replenishment.order_decisions row, or null when undecided. */
  decision?: { decision_id: string; decision_status: string; final_order_units: number; version: number } | null;
}

/** In-memory stand-in for the Lakebase pool: answers each statement the routes issue and records every call. */
function fakeLakebase(state: FakeState) {
  const calls: Call[] = [];
  const respond = (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (text.includes('FROM replenishment.user_scope')) {
      const email = String(params[0]).toLowerCase();
      return { rows: state.scope?.[email] ?? [] };
    }
    if (text.includes('AS in_scope')) {
      if (!state.rec) return { rows: [] };
      const [, restricted, regions, locations] = params as [string, boolean, string[], string[]];
      const inScope = !restricted || regions.includes(state.rec.region) || locations.includes(state.rec.location_id);
      return {
        rows: [
          {
            recommended_units: state.rec.recommended_units,
            as_of_date: '2026-08-31',
            location_id: state.rec.location_id,
            sku_id: 'SKU-MC02',
            in_scope: inScope,
          },
        ],
      };
    }
    if (text.includes('FOR UPDATE')) return { rows: state.decision ? [state.decision] : [] };
    if (text.includes('UPDATE replenishment.order_decisions')) {
      const version = (state.decision?.version ?? 0) + 1;
      return { rows: [{ decision_id: 'd-1', decision_status: params[1], final_order_units: params[2], version }] };
    }
    if (text.includes('INSERT INTO replenishment.order_decisions')) {
      return { rows: [{ decision_id: 'd-1', decision_status: params[4], final_order_units: params[6], version: 1 }] };
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
  return { db, calls };
}

let server: Server | null = null;

async function start(db: Lakebase) {
  const app = express();
  app.use(express.json());
  registerReplenishmentRoutes(app, db);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

async function decide(base: string, body: unknown, email = 'planner@eastwind.example') {
  const res = await fetch(`${base}/api/recommendations/rec-1/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-email': email },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const REC = { recommended_units: 624, region: 'Central', location_id: 'L0022' };

describe('POST /api/recommendations/:id/decision', () => {
  it('rejects an adjustment without a reason with 400 and never opens a transaction', async () => {
    const { db, calls } = fakeLakebase({ rec: REC, decision: null });
    const base = await start(db);
    const res = await decide(base, { status: 'ADJUSTED', finalUnits: 500, expectedVersion: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('An adjusted order needs the new quantity and a reason');
    expect(calls.some((c) => c.text === 'BEGIN')).toBe(false);
  });

  it('rejects a rejection without a reason, an unknown status and negative units with 400', async () => {
    const { db } = fakeLakebase({ rec: REC, decision: null });
    const base = await start(db);
    expect((await decide(base, { status: 'REJECTED', expectedVersion: null })).status).toBe(400);
    expect((await decide(base, { status: 'APPROVED', expectedVersion: null })).status).toBe(400);
    expect(
      (await decide(base, { status: 'ADJUSTED', finalUnits: -5, reason: 'x', expectedVersion: null })).status
    ).toBe(400);
  });

  it('returns 409 with the current version when the expected version is stale', async () => {
    const decision = { decision_id: 'd-1', decision_status: 'ACCEPTED', final_order_units: 624, version: 2 };
    const { db, calls } = fakeLakebase({ rec: REC, decision });
    const base = await start(db);
    const res = await decide(base, { status: 'ACCEPTED', expectedVersion: 1 });
    expect(res.status).toBe(409);
    expect(res.body.currentVersion).toBe(2);
    expect(calls.map((c) => c.text)).toContain('ROLLBACK');
    expect(calls.some((c) => c.text.includes('INSERT INTO replenishment.decision_events'))).toBe(false);
  });

  it('returns 409 when someone decided first and the client still expects no decision', async () => {
    const decision = { decision_id: 'd-1', decision_status: 'REJECTED', final_order_units: 0, version: 1 };
    const { db } = fakeLakebase({ rec: REC, decision });
    const base = await start(db);
    const res = await decide(base, { status: 'ACCEPTED', expectedVersion: null });
    expect(res.status).toBe(409);
    expect(res.body.currentVersion).toBe(1);
  });

  it('accepts a new decision at the recommended quantity (201) and writes the audit event', async () => {
    const { db, calls } = fakeLakebase({ rec: REC, decision: null });
    const base = await start(db);
    const res = await decide(base, { status: 'ACCEPTED', expectedVersion: null });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ decision_status: 'ACCEPTED', final_order_units: 624, version: 1 });
    const insert = calls.find((c) => c.text.includes('INSERT INTO replenishment.order_decisions'));
    expect(insert?.params[8]).toBe('planner@eastwind.example');
    const event = calls.find((c) => c.text.includes('INSERT INTO replenishment.decision_events'));
    expect(event?.params.slice(2, 6)).toEqual([null, 'ACCEPTED', null, 624]);
    expect(calls.map((c) => c.text)).toContain('COMMIT');
  });

  it('adjusts an existing decision (200), bumps the version and records the previous units', async () => {
    const decision = { decision_id: 'd-1', decision_status: 'ACCEPTED', final_order_units: 624, version: 1 };
    const { db, calls } = fakeLakebase({ rec: REC, decision });
    const base = await start(db);
    const res = await decide(base, {
      status: 'ADJUSTED',
      finalUnits: 480,
      reason: 'Store refit in week 2',
      expectedVersion: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ decision_status: 'ADJUSTED', final_order_units: 480, version: 2 });
    const event = calls.find((c) => c.text.includes('INSERT INTO replenishment.decision_events'));
    expect(event?.params.slice(2, 7)).toEqual(['ACCEPTED', 'ADJUSTED', 624, 480, 'Store refit in week 2']);
  });

  it('rejects with a reason and saves zero units', async () => {
    const { db } = fakeLakebase({ rec: REC, decision: null });
    const base = await start(db);
    const res = await decide(base, { status: 'REJECTED', reason: 'Store closing', expectedVersion: null });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ decision_status: 'REJECTED', final_order_units: 0 });
  });

  it('returns 404 for an unknown recommendation', async () => {
    const { db } = fakeLakebase({ rec: null });
    const base = await start(db);
    expect((await decide(base, { status: 'ACCEPTED', expectedVersion: null })).status).toBe(404);
  });

  it('returns 403 when the store is outside the planner scope, whatever the client sends', async () => {
    const scope = { 'north.planner@eastwind.example': [{ region: 'North', location_id: null }] };
    const { db, calls } = fakeLakebase({ rec: REC, decision: null, scope });
    const base = await start(db);
    const res = await decide(base, { status: 'ACCEPTED', expectedVersion: null }, 'north.planner@eastwind.example');
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.text.includes('INSERT'))).toBe(false);
  });
});

describe('scope', () => {
  it('is network-wide for unmapped users in open mode and empty in strict mode', async () => {
    const { db } = fakeLakebase({});
    expect(await resolveScope(db, 'analyst@eastwind.example', 'open')).toEqual({
      restricted: false,
      regions: [],
      locations: [],
    });
    expect(await resolveScope(db, 'analyst@eastwind.example', 'strict')).toEqual({
      restricted: true,
      regions: [],
      locations: [],
    });
  });

  it('applies the server-side scope to the list even when the client asks for another region', async () => {
    const scope = {
      'north.planner@eastwind.example': [
        { region: 'North', location_id: null },
        { region: null, location_id: 'L0022' },
      ],
    };
    const { db, calls } = fakeLakebase({ scope });
    const base = await start(db);
    const res = await fetch(`${base}/api/recommendations?region=South`, {
      headers: { 'x-forwarded-email': 'north.planner@eastwind.example' },
    });
    expect(res.status).toBe(200);
    const list = calls.find((c) => c.text.includes('count(*) OVER ()'));
    expect(list?.params.slice(0, 7)).toEqual(['South', null, null, null, true, ['North'], ['L0022']]);
  });

  it('rejects malformed filters with 400', async () => {
    const { db } = fakeLakebase({});
    const base = await start(db);
    expect((await fetch(`${base}/api/recommendations?channel=MALL`)).status).toBe(400);
    expect((await fetch(`${base}/api/recommendations?limit=1000`)).status).toBe(400);
  });
});
