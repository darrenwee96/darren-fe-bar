import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { sql } from '@databricks/appkit-ui/js';
import type { ScopeFilters } from './api';

export const ALL = 'ALL';

export const CHANNEL_OPTIONS = [
  { value: 'DOWNTOWN', label: 'Downtown' },
  { value: 'HIGHWAY', label: 'Highway' },
  { value: 'AIRPORT', label: 'Airport' },
];

const KEYS = ['region', 'channel', 'category', 'location'] as const;
export type FilterKey = (typeof KEYS)[number];

/**
 * Global control-panel filters, kept in the URL (?region=North&location=L0022) so a filtered view can be shared.
 * They narrow every panel; the server still applies the signed-in user's planning scope on top.
 */
export function useGlobalFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<ScopeFilters>(() => {
    const out: ScopeFilters = {};
    for (const key of KEYS) {
      const value = params.get(key);
      if (value) out[key] = value;
    }
    return out;
  }, [params]);

  const setFilter = useCallback(
    (key: FilterKey, value: string | undefined) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (!value || value === ALL) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true }
      ),
    [setParams]
  );

  const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);
  const active = KEYS.filter((k) => filters[k]).length;
  return { filters, setFilter, clear, active };
}

/** Warehouse query parameters for the same filters ('ALL' = no filter). */
export function warehouseParams(filters: ScopeFilters) {
  return {
    region: sql.string(filters.region ?? ALL),
    channel: sql.string(filters.channel ?? ALL),
    category: sql.string(filters.category ?? ALL),
    location_id: sql.string(filters.location ?? ALL),
  };
}
