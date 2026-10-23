// Keeps replenishment.line_context in step with serving.recommendations: last year's festival-aligned demand per
// line, which the VS_LAST_YEAR exception rule needs and the Lakebase load does not carry. The app copies it from the
// warehouse whenever the recommendations are reloaded (checked every few minutes). If the warehouse is unreachable
// the table keeps its previous rows, and lines without a row simply cannot trigger that one rule.

import { LAST_YEAR_COVER_SQL } from './exceptions';
import type { Lakebase } from './replenishment-routes';

export interface Warehouse {
  /** AppKit analytics.query(): runs SQL on the app's warehouse as the service principal. */
  query(statement: string): Promise<unknown>;
}

interface ContextRow {
  recommendation_id: string;
  forecast_run_id: string | null;
  last_year_cover_units: number | null;
}

/** Read `{ data: [{col: value}] }` (AppKit JSON result) into typed rows; numbers arrive as strings. */
export function parseContextRows(result: unknown): ContextRow[] {
  const data =
    typeof result === 'object' && result !== null && 'data' in result && Array.isArray(result.data) ? result.data : [];
  const rows: ContextRow[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    const id = raw.recommendation_id;
    if (typeof id !== 'string' || !id) continue;
    const units = raw.last_year_cover_units == null ? null : Number(raw.last_year_cover_units);
    rows.push({
      recommendation_id: id,
      forecast_run_id: typeof raw.forecast_run_id === 'string' ? raw.forecast_run_id : null,
      last_year_cover_units: units !== null && Number.isFinite(units) ? units : null,
    });
  }
  return rows;
}

/** Replace the context rows in one transaction. Returns the number of rows written. */
export async function writeLineContext(db: Lakebase, rows: ContextRow[]): Promise<number> {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM replenishment.line_context');
    await client.query(
      `INSERT INTO replenishment.line_context (recommendation_id, forecast_run_id, last_year_cover_units)
       SELECT * FROM unnest($1::text[], $2::text[], $3::double precision[])`,
      [
        rows.map((r) => r.recommendation_id),
        rows.map((r) => r.forecast_run_id),
        rows.map((r) => r.last_year_cover_units),
      ]
    );
    await client.query('COMMIT');
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Refresh line_context when the recommendations were reloaded since the last copy (or it is empty). Never throws:
 * a failed refresh is logged and retried on the next tick.
 */
export function startLineContextSync(db: Lakebase, warehouse: Warehouse, intervalMs = 5 * 60_000) {
  let lastLoaded: string | null = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { rows } = await db.query(
        `SELECT (SELECT max(loaded_at)::text FROM serving.recommendations) AS loaded_at,
                (SELECT count(*) FROM replenishment.line_context) AS context_rows`
      );
      const loaded = typeof rows[0]?.loaded_at === 'string' ? rows[0].loaded_at : null;
      if (loaded === null || (loaded === lastLoaded && Number(rows[0].context_rows) > 0)) return;
      const written = await writeLineContext(db, parseContextRows(await warehouse.query(LAST_YEAR_COVER_SQL)));
      lastLoaded = loaded;
      console.log(`[replenishment] line_context refreshed: ${written} lines (recommendations loaded ${loaded})`);
    } catch (err) {
      console.warn('[replenishment] line_context refresh failed:', (err as Error).message);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
