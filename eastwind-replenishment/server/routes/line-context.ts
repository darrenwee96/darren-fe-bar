// Keeps replenishment.line_context in step with serving.recommendations: last year's festival-aligned demand per
// line, which the VS_LAST_YEAR exception rule needs and the Lakebase load does not carry. The app copies it from the
// warehouse whenever the recommendations are reloaded (checked every few minutes). If the warehouse is unreachable or
// returns an empty or malformed result, the refresh fails and the table keeps its previous rows; lines without a row
// simply cannot trigger that one rule.

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

/**
 * Read `{ data: [{col: value}] }` (AppKit JSON result) into typed rows; numbers arrive as strings. Strict: a result
 * that is not that shape, is empty, or has any row without an id or with a non-numeric value is rejected as a whole,
 * so a bad warehouse answer can never replace good context.
 */
export function parseContextRows(result: unknown): ContextRow[] {
  const data =
    typeof result === 'object' && result !== null && 'data' in result && Array.isArray(result.data)
      ? (result.data as unknown[])
      : null;
  if (!data) throw new Error('Warehouse returned no result set for last-year context');
  if (data.length === 0) throw new Error('Warehouse returned no last-year context rows');
  return data.map((raw, i) => {
    const row = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const id = row.recommendation_id;
    if (typeof id !== 'string' || !id) throw new Error(`Last-year context row ${i} has no recommendation_id`);
    const units = row.last_year_cover_units == null ? null : Number(row.last_year_cover_units);
    if (units !== null && !Number.isFinite(units))
      throw new Error(`Last-year context row ${i} has a non-numeric last_year_cover_units`);
    return {
      recommendation_id: id,
      forecast_run_id: typeof row.forecast_run_id === 'string' ? row.forecast_run_id : null,
      last_year_cover_units: units,
    };
  });
}

/** Replace the context rows in one transaction; refuses an empty set. Returns the number of rows written. */
export async function writeLineContext(db: Lakebase, rows: ContextRow[]): Promise<number> {
  if (rows.length === 0) throw new Error('Refusing to replace line_context with an empty set');
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
 * Copy last-year context from the warehouse into Lakebase. The warehouse is queried and its answer validated BEFORE
 * any write, so a failed, empty or malformed result throws and leaves the previous rows untouched.
 */
export async function refreshLineContext(db: Lakebase, warehouse: Warehouse): Promise<number> {
  const rows = parseContextRows(await warehouse.query(LAST_YEAR_COVER_SQL));
  return writeLineContext(db, rows);
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
      const written = await refreshLineContext(db, warehouse);
      lastLoaded = loaded;
      console.log(`[replenishment] line_context refreshed: ${written} lines (recommendations loaded ${loaded})`);
    } catch (err) {
      console.warn('[replenishment] line_context refresh failed; previous rows kept:', (err as Error).message);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
