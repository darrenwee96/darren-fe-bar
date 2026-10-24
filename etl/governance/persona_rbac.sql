-- Eastwind Gourmet: Unity Catalog governance for the replenishment demo ("Viewing as" personas).
--
-- Idempotent: every statement is CREATE ... IF NOT EXISTS, CREATE OR REPLACE, MERGE or ALTER ... SET, so the whole
-- file can be rerun. Apply it with:  python3 etl/governance/apply_governance.py --profile fe-bar
--
-- What it creates in darren_fe_bar_catalog:
--   governance.persona_access         who may see which regions / stores, and decide (the governed mapping)
--   governance.rf_store_scope         row filter on gold.replenishment_recommendations_current (caller's bindings)
--   governance.mask_unit_cost         column mask on unit_cost (hidden unless a binding has sees_unit_cost)
--   governance.persona_row_visible    same predicate for a named persona: lets the app show UC-evaluated row counts
--   governance.persona_sees_unit_cost same mask rule for a named persona
--   GRANTs to the four persona account groups and the app's service principal
--
-- A caller is bound to a mapping row through an ACCOUNT group (is_account_group_member) or an explicit principal
-- (current_user(): a user's email or a service principal's application id). No binding = no rows (fail-closed).
-- The pipeline owner and the app's service principal hold explicit network-wide bindings, so the weekly job (MERGE
-- into the table, Lakebase load), the Genie space and the app's warehouse reads keep seeing every row.

CREATE SCHEMA IF NOT EXISTS darren_fe_bar_catalog.governance
COMMENT 'Unity Catalog governance for the replenishment demo: persona mapping, row filter and column mask functions.';

CREATE TABLE IF NOT EXISTS darren_fe_bar_catalog.governance.persona_access (
  binding_id STRING NOT NULL COMMENT 'Stable key for this mapping row',
  persona_id STRING NOT NULL COMMENT 'Persona key the app sends as x-eastwind-persona',
  persona_label STRING NOT NULL,
  role STRING NOT NULL COMMENT 'ANALYST | PLANNER | STORE_MANAGER | AUDITOR | SERVICE',
  uc_group STRING COMMENT 'Account group whose members get this binding (is_account_group_member)',
  principal STRING COMMENT 'Or one explicit principal: user email or service principal application id (current_user())',
  region STRING COMMENT '* = every region; otherwise one region',
  store_id STRING COMMENT 'One store (location_id) when the binding is store-level',
  can_decide BOOLEAN NOT NULL COMMENT 'May accept / adjust / reject order lines in the app',
  sees_unit_cost BOOLEAN NOT NULL COMMENT 'unit_cost is unmasked for this binding',
  sort_order INT,
  note STRING
)
COMMENT 'Governed persona -> scope mapping. Read by the row filter / column mask functions and by the replenishment app.';

MERGE INTO darren_fe_bar_catalog.governance.persona_access t
USING (
  SELECT * FROM VALUES
    ('head_office_analyst', 'head_office_analyst', 'Head-office Analyst', 'ANALYST', 'eastwind_head_office', CAST(NULL AS STRING), '*', CAST(NULL AS STRING), true, true, 1, 'All regions, can decide'),
    ('regional_planner_north', 'regional_planner_north', 'Regional Planner · North', 'PLANNER', 'eastwind_planners_north', NULL, 'North', NULL, true, true, 2, 'North region only, can decide'),
    ('store_manager_l0001', 'store_manager_l0001', 'Store Manager · Zhongshan Shop L0001', 'STORE_MANAGER', 'eastwind_store_l0001', NULL, NULL, 'L0001', true, false, 3, 'One store, can decide its lines; unit cost masked'),
    ('auditor', 'auditor', 'Auditor · Read-only', 'AUDITOR', 'eastwind_auditors', NULL, '*', NULL, false, true, 4, 'All regions, read-only'),
    ('svc_pipeline_owner', 'svc_pipeline_owner', 'Pipeline owner (jobs, Genie)', 'SERVICE', NULL, 'darren.wee@databricks.com', '*', NULL, false, true, 90, 'Runs the weekly MERGE + Lakebase load and owns the Genie space'),
    ('svc_app', 'svc_app', 'Replenishment app service principal', 'SERVICE', NULL, 'f4a2a131-92ee-4cf6-a1fa-189103f3f3cd', '*', NULL, false, true, 91, 'App warehouse reads (last-year context, governance panel)')
  AS v(binding_id, persona_id, persona_label, role, uc_group, principal, region, store_id, can_decide, sees_unit_cost, sort_order, note)
) s
ON t.binding_id = s.binding_id
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *;

-- Row filter: a row is visible when ANY of the caller's bindings covers its region or store.
CREATE OR REPLACE FUNCTION darren_fe_bar_catalog.governance.rf_store_scope(row_region STRING, row_location_id STRING)
RETURNS BOOLEAN
COMMENT 'Row filter: caller sees a row when one of their persona_access bindings (account group or principal) covers its region or store.'
RETURN EXISTS (
  SELECT 1 FROM darren_fe_bar_catalog.governance.persona_access p
  WHERE ((p.uc_group IS NOT NULL AND is_account_group_member(p.uc_group))
         OR (p.principal IS NOT NULL AND lower(p.principal) = lower(current_user())))
    AND (p.region = '*' OR p.region = row_region OR p.store_id = row_location_id)
);

-- Column mask: unit cost is shown only when one of the caller's bindings has sees_unit_cost.
CREATE OR REPLACE FUNCTION darren_fe_bar_catalog.governance.mask_unit_cost(unit_cost DOUBLE)
RETURNS DOUBLE
COMMENT 'Column mask: NULL unless one of the caller''s persona_access bindings has sees_unit_cost.'
RETURN CASE WHEN EXISTS (
  SELECT 1 FROM darren_fe_bar_catalog.governance.persona_access p
  WHERE p.sees_unit_cost
    AND ((p.uc_group IS NOT NULL AND is_account_group_member(p.uc_group))
         OR (p.principal IS NOT NULL AND lower(p.principal) = lower(current_user())))
) THEN unit_cost ELSE NULL END;

-- The same predicate for a NAMED persona: the app evaluates it to show "rows UC would return for this persona".
CREATE OR REPLACE FUNCTION darren_fe_bar_catalog.governance.persona_row_visible(persona STRING, row_region STRING, row_location_id STRING)
RETURNS BOOLEAN
COMMENT 'rf_store_scope evaluated for a named persona instead of the caller (for previews and the app governance panel).'
RETURN EXISTS (
  SELECT 1 FROM darren_fe_bar_catalog.governance.persona_access p
  WHERE p.persona_id = persona
    AND (p.region = '*' OR p.region = row_region OR p.store_id = row_location_id)
);

CREATE OR REPLACE FUNCTION darren_fe_bar_catalog.governance.persona_sees_unit_cost(persona STRING)
RETURNS BOOLEAN
COMMENT 'mask_unit_cost evaluated for a named persona.'
RETURN EXISTS (
  SELECT 1 FROM darren_fe_bar_catalog.governance.persona_access p WHERE p.persona_id = persona AND p.sees_unit_cost
);

ALTER TABLE darren_fe_bar_catalog.gold.replenishment_recommendations_current
  SET ROW FILTER darren_fe_bar_catalog.governance.rf_store_scope ON (region, location_id);

ALTER TABLE darren_fe_bar_catalog.gold.replenishment_recommendations_current
  ALTER COLUMN unit_cost SET MASK darren_fe_bar_catalog.governance.mask_unit_cost;

-- GRANTs. The four persona groups must be ACCOUNT groups (UC cannot grant to workspace-local groups); the runner
-- reports any group that does not exist yet and carries on.
GRANT USE CATALOG ON CATALOG darren_fe_bar_catalog TO `f4a2a131-92ee-4cf6-a1fa-189103f3f3cd`;
GRANT USE SCHEMA ON SCHEMA darren_fe_bar_catalog.governance TO `f4a2a131-92ee-4cf6-a1fa-189103f3f3cd`;
GRANT SELECT ON TABLE darren_fe_bar_catalog.governance.persona_access TO `f4a2a131-92ee-4cf6-a1fa-189103f3f3cd`;
GRANT EXECUTE ON FUNCTION darren_fe_bar_catalog.governance.persona_row_visible TO `f4a2a131-92ee-4cf6-a1fa-189103f3f3cd`;
GRANT EXECUTE ON FUNCTION darren_fe_bar_catalog.governance.persona_sees_unit_cost TO `f4a2a131-92ee-4cf6-a1fa-189103f3f3cd`;
-- EXECUTE on the filter and mask lets the app read their definitions from information_schema.routines (governance panel).
GRANT EXECUTE ON FUNCTION darren_fe_bar_catalog.governance.rf_store_scope TO `f4a2a131-92ee-4cf6-a1fa-189103f3f3cd`;
GRANT EXECUTE ON FUNCTION darren_fe_bar_catalog.governance.mask_unit_cost TO `f4a2a131-92ee-4cf6-a1fa-189103f3f3cd`;

GRANT USE CATALOG ON CATALOG darren_fe_bar_catalog TO `eastwind_head_office`;
GRANT USE SCHEMA ON SCHEMA darren_fe_bar_catalog.gold TO `eastwind_head_office`;
GRANT SELECT ON TABLE darren_fe_bar_catalog.gold.replenishment_recommendations_current TO `eastwind_head_office`;
GRANT SELECT ON TABLE darren_fe_bar_catalog.gold.order_decisions_history TO `eastwind_head_office`;

GRANT USE CATALOG ON CATALOG darren_fe_bar_catalog TO `eastwind_planners_north`;
GRANT USE SCHEMA ON SCHEMA darren_fe_bar_catalog.gold TO `eastwind_planners_north`;
GRANT SELECT ON TABLE darren_fe_bar_catalog.gold.replenishment_recommendations_current TO `eastwind_planners_north`;

GRANT USE CATALOG ON CATALOG darren_fe_bar_catalog TO `eastwind_store_l0001`;
GRANT USE SCHEMA ON SCHEMA darren_fe_bar_catalog.gold TO `eastwind_store_l0001`;
GRANT SELECT ON TABLE darren_fe_bar_catalog.gold.replenishment_recommendations_current TO `eastwind_store_l0001`;

GRANT USE CATALOG ON CATALOG darren_fe_bar_catalog TO `eastwind_auditors`;
GRANT USE SCHEMA ON SCHEMA darren_fe_bar_catalog.gold TO `eastwind_auditors`;
GRANT SELECT ON TABLE darren_fe_bar_catalog.gold.replenishment_recommendations_current TO `eastwind_auditors`;
GRANT SELECT ON TABLE darren_fe_bar_catalog.gold.order_decisions_history TO `eastwind_auditors`;
GRANT SELECT ON TABLE darren_fe_bar_catalog.gold.order_decision_events TO `eastwind_auditors`;
