// "Viewing as" personas, read from the Unity Catalog mapping darren_fe_bar_catalog.governance.persona_access
// (etl/governance/persona_rbac.sql) and enforced here on every read and write.
//
// A persona can only NARROW what the signed-in user may already do: its scope is intersected with the user's own
// replenishment.user_scope, and writes need both the user's scope and the persona's can_decide. The persona arrives as
// the x-eastwind-persona header; the server validates it against the governed mapping and ignores it unless
// DEMO_PERSONAS=true. The client never sends a scope, only a persona id.
//
// The app reads Lakebase copies, so UC's row filter does not run on those queries: the app applies the same mapping
// itself. The governance panel shows what UC evaluates for the persona (governance.persona_row_visible) next to it.

import type { Warehouse } from './line-context';
import type { Scope } from './replenishment-routes';

export const PERSONA_HEADER = 'x-eastwind-persona';
/** The signed-in user's own scope (no persona). */
export const SELF = 'self';

const CATALOG = 'darren_fe_bar_catalog';
export const UC = {
  mappingTable: `${CATALOG}.governance.persona_access`,
  table: `${CATALOG}.gold.replenishment_recommendations_current`,
  personaRowVisible: `${CATALOG}.governance.persona_row_visible`,
  personaSeesUnitCost: `${CATALOG}.governance.persona_sees_unit_cost`,
} as const;

/** Columns UC masks for a persona without sees_unit_cost, and the app fields derived from them. */
export const COST_FIELDS = [
  'unit_cost',
  'order_value_at_cost',
  'pending_value_at_cost',
  'routine_pending_value_at_cost',
];

export interface PersonaBinding {
  ucGroup: string | null;
  region: string | null;
  storeId: string | null;
}

export interface Persona {
  id: string;
  label: string;
  role: 'ANALYST' | 'PLANNER' | 'STORE_MANAGER' | 'AUDITOR';
  canDecide: boolean;
  seesUnitCost: boolean;
  scope: Scope;
  bindings: PersonaBinding[];
}

export interface PersonaSource {
  list(): Promise<Persona[]>;
}

export class PersonaError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const personasEnabled = (env: NodeJS.ProcessEnv = process.env) => env.DEMO_PERSONAS?.trim() === 'true';

const ROLES = new Set(['ANALYST', 'PLANNER', 'STORE_MANAGER', 'AUDITOR']);
const PERSONA_ID = /^[a-z0-9_]{1,64}$/;

const rowsOf = (result: unknown): Record<string, unknown>[] =>
  typeof result === 'object' && result !== null && 'data' in result && Array.isArray(result.data)
    ? (result.data as Record<string, unknown>[])
    : [];
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
const bool = (v: unknown) => v === true || v === 'true';

/**
 * Group persona_access rows into personas (several rows = several bindings of one persona). SERVICE rows (pipeline
 * owner, app service principal) are not selectable. A persona's scope is open only with an explicit region '*'.
 */
export function personasFromRows(rows: Record<string, unknown>[]): Persona[] {
  const byId = new Map<string, Persona & { order: number }>();
  for (const r of rows) {
    const id = str(r.persona_id);
    const role = str(r.role);
    if (!id || !PERSONA_ID.test(id) || !role || !ROLES.has(role)) continue;
    const p = byId.get(id) ?? {
      id,
      label: str(r.persona_label) ?? id,
      role: role as Persona['role'],
      canDecide: false,
      seesUnitCost: false,
      scope: { restricted: true, regions: [], locations: [] },
      bindings: [],
      order: Number(r.sort_order ?? 99),
    };
    const region = str(r.region);
    const storeId = str(r.store_id);
    p.bindings.push({ ucGroup: str(r.uc_group), region, storeId });
    p.canDecide ||= bool(r.can_decide);
    p.seesUnitCost ||= bool(r.sees_unit_cost);
    if (region === '*') p.scope = { restricted: false, regions: [], locations: [] };
    else if (p.scope.restricted) {
      if (region && !p.scope.regions.includes(region)) p.scope.regions.push(region);
      if (storeId && !p.scope.locations.includes(storeId)) p.scope.locations.push(storeId);
    }
    byId.set(id, p);
  }
  return [...byId.values()].sort((a, b) => a.order - b.order).map(({ order: _order, ...p }) => p);
}

export const PERSONAS_SQL = `
  SELECT persona_id, persona_label, role, uc_group, region, store_id, can_decide, sees_unit_cost, sort_order
  FROM ${UC.mappingTable}
  WHERE role <> 'SERVICE'`;

/** Personas from the UC mapping, cached briefly. A failed read throws (callers fail closed) and is retried next time. */
export function ucPersonaSource(warehouse: Warehouse, ttlMs = 60_000): PersonaSource {
  let cached: { at: number; personas: Persona[] } | null = null;
  return {
    async list() {
      if (cached && Date.now() - cached.at < ttlMs) return cached.personas;
      const personas = personasFromRows(rowsOf(await warehouse.query(PERSONAS_SQL)));
      cached = { at: Date.now(), personas };
      return personas;
    },
  };
}

const visible = (s: Scope, store: { location_id: string; region: string }) =>
  !s.restricted || s.regions.includes(store.region) || s.locations.includes(store.location_id);

/**
 * The intersection of the user's scope and the persona's: never wider than either. When both are restricted it is
 * resolved to the explicit stores both allow (`stores` = every store with its region).
 */
export function narrowScope(user: Scope, persona: Scope, stores: { location_id: string; region: string }[]): Scope {
  if (!persona.restricted) return user;
  if (!user.restricted) return persona;
  const locations = stores.filter((s) => visible(user, s) && visible(persona, s)).map((s) => s.location_id);
  return { restricted: true, regions: [], locations: [...new Set(locations)].sort() };
}

/** The persona id the request asks for: null = the user's own scope (also when personas are disabled). */
export function requestedPersona(header: string | undefined, enabled: boolean): string | null {
  if (!enabled) return null;
  const raw = header?.trim();
  if (!raw || raw === SELF) return null;
  if (!PERSONA_ID.test(raw)) throw new PersonaError('Unknown persona', 400, 'UNKNOWN_PERSONA');
  return raw;
}

const GOVERNANCE_SQL = {
  rowFilter: `SELECT filter_name, target_columns FROM ${CATALOG}.information_schema.row_filters
              WHERE table_schema = 'gold' AND table_name = 'replenishment_recommendations_current'`,
  masks: `SELECT column_name, mask_name FROM ${CATALOG}.information_schema.column_masks
          WHERE table_schema = 'gold' AND table_name = 'replenishment_recommendations_current'`,
  routines: `SELECT routine_name, routine_definition FROM ${CATALOG}.information_schema.routines
             WHERE routine_schema = 'governance'`,
  grants: `SELECT grantee, privilege_type FROM ${CATALOG}.information_schema.table_privileges
           WHERE table_schema = 'gold' AND table_name = 'replenishment_recommendations_current'
           ORDER BY grantee, privilege_type`,
  counts: `SELECT p.persona_id,
                  count_if(${UC.personaRowVisible}(p.persona_id, r.region, r.location_id)) AS visible,
                  count(*) AS total,
                  ${UC.personaSeesUnitCost}(p.persona_id) AS sees_unit_cost
           FROM (SELECT DISTINCT persona_id FROM ${UC.mappingTable} WHERE role <> 'SERVICE') p
           CROSS JOIN ${UC.table} r
           GROUP BY p.persona_id`,
};

export interface UcGovernance {
  table: string;
  mappingTable: string;
  rowFilter: { name: string; columns: string; definition: string | null } | null;
  masks: { column: string; name: string; definition: string | null }[];
  grants: { grantee: string; privilege: string }[];
  /** What UC evaluates per persona: persona_row_visible over the Gold table, and persona_sees_unit_cost. */
  personaCounts: Record<string, { visible: number; total: number; seesUnitCost: boolean }>;
  readAt: string;
}

/** Live UC metadata for the governance panel (information_schema + the persona predicate), cached briefly. */
export function ucGovernanceSource(warehouse: Warehouse, ttlMs = 60_000) {
  let cached: { at: number; value: UcGovernance } | null = null;
  return async function read(): Promise<UcGovernance> {
    if (cached && Date.now() - cached.at < ttlMs) return cached.value;
    const [rowFilter, masks, routines, grants, counts] = await Promise.all(
      [
        GOVERNANCE_SQL.rowFilter,
        GOVERNANCE_SQL.masks,
        GOVERNANCE_SQL.routines,
        GOVERNANCE_SQL.grants,
        GOVERNANCE_SQL.counts,
      ].map(async (q) => rowsOf(await warehouse.query(q)))
    );
    const definition = (fullName: string) => {
      const name = fullName.split('.').pop();
      return str(routines.find((r) => r.routine_name === name)?.routine_definition);
    };
    const rf = rowFilter[0];
    const value: UcGovernance = {
      table: UC.table,
      mappingTable: UC.mappingTable,
      rowFilter: rf
        ? {
            name: String(rf.filter_name),
            columns: String(rf.target_columns),
            definition: definition(String(rf.filter_name)),
          }
        : null,
      masks: masks.map((m) => ({
        column: String(m.column_name),
        name: String(m.mask_name),
        definition: definition(String(m.mask_name)),
      })),
      grants: grants.map((g) => ({ grantee: String(g.grantee), privilege: String(g.privilege_type) })),
      personaCounts: Object.fromEntries(
        counts.map((c) => [
          String(c.persona_id),
          { visible: Number(c.visible), total: Number(c.total), seesUnitCost: bool(c.sees_unit_cost) },
        ])
      ),
      readAt: new Date().toISOString(),
    };
    cached = { at: Date.now(), value };
    return value;
  };
}

/** Null the cost columns UC masks for this persona (and the values derived from them) in an API row. */
export function maskCost<T extends Record<string, unknown>>(row: T, masked: boolean): T {
  if (!masked) return row;
  const out: Record<string, unknown> = { ...row };
  for (const f of COST_FIELDS) if (f in out) out[f] = null;
  return out as T;
}
