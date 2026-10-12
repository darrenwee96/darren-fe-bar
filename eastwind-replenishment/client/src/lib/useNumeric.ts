import { useMemo } from 'react';

const NUMERIC = /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/**
 * Warehouse JSON results deliver DECIMAL / DOUBLE / BIGINT values as strings. Convert numeric-looking strings to
 * numbers (except *_id keys) so arithmetic, sorting and comparisons work as the generated types promise.
 */
export function useNumeric<T extends Record<string, unknown>>(rows: T[] | null | undefined): T[] | null {
  return useMemo(() => {
    if (!rows) return null;
    return rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = typeof v === 'string' && !k.endsWith('_id') && NUMERIC.test(v.trim()) ? Number(v) : v;
      }
      return out as T;
    });
  }, [rows]);
}
