import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { sql } from '@databricks/appkit-ui/js';
import { SELF_PERSONA, type Scope, type ScopeFilters } from './api';

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

  const clear = useCallback(
    () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const key of KEYS) next.delete(key);
          return next;
        },
        { replace: true }
      ),
    [setParams]
  );
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

const PERSONA_KEY = 'viewAs';

/**
 * The "Viewing as" persona, kept in the URL (?viewAs=store_manager_l0001) so a view can be shared. Switching persona
 * drops the global filters, which may point outside the new scope. The server validates the persona and can only
 * narrow the signed-in scope with it.
 */
export function usePersonaParam() {
  const [params, setParams] = useSearchParams();
  const persona = params.get(PERSONA_KEY) || SELF_PERSONA;
  const setPersona = useCallback(
    (id: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const key of KEYS) next.delete(key);
          if (id === SELF_PERSONA) next.delete(PERSONA_KEY);
          else next.set(PERSONA_KEY, id);
          return next;
        },
        { replace: true }
      ),
    [setParams]
  );
  return { persona, setPersona };
}

/**
 * Pin the warehouse-fed charts (forecast, waste) to a persona's single region or store. Those charts are aggregate
 * SQL-warehouse reads; the order lines, KPIs and decisions are scoped on the server.
 */
export function pinToScope(filters: ScopeFilters, scope: Scope | undefined): ScopeFilters {
  if (!scope?.restricted) return filters;
  if (scope.locations.length === 1 && scope.regions.length === 0) return { ...filters, location: scope.locations[0] };
  if (scope.regions.length === 1 && scope.locations.length === 0) return { ...filters, region: scope.regions[0] };
  return filters;
}
