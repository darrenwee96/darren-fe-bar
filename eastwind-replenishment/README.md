# Eastwind Replenishment: demand and order control panel

A Databricks App (AppKit: React + TypeScript + Express) that planners and analysts at Eastwind Gourmet use to approve
the weekly store orders the forecast recommends. It puts the decision and its evidence on one screen:

- **Header:** one line with the order week, when the data was loaded and the model version.
- **KPI strip (four tiles, in the deck's order):** peak lines needing an order, peak sales at risk, lines that need you
  today, and the waste guardrail (expired + markdown, last 13 weeks vs a year earlier).
- **Needs review (management by exception):** only the lines an exception rule flags, sorted by $ at risk and grouped by
  store, with a count ("231 of 1,561 lines need you"). Everything else is collapsed into one routine row with
  **Accept all routine**. Exception lines can be ticked and accepted together; adjust and reject stay one line at a
  time with a required reason. Every decision is written to Lakebase with optimistic locking and an append-only audit
  trail, one row per line, also for bulk accepts.
- **Forecast vs actual:** 26 weeks of actual units, the 6-week forecast with its p90 band, the same week last year and
  a marker on each festival week, for whatever the filters select (network, region, channel, category, or one store).
  The side sheet shows the same chart for a single store-SKU.
- **Order need by store:** the top 10 stores by sales at stake. Click one to drill every panel down to that store.
- **Ask Genie:** a docked natural-language panel over the curated Genie space. It runs on behalf of the signed-in user
  and shows the generated SQL.

Global filters (region, channel, category, store) live in the URL, so a filtered view can be shared. There is a
single view with drill-down and no tab pages.

Order reasons are written in plain words, strongest first, and drivers that move the forecast by zero units are never
shown (`client/src/lib/reasons.ts`), e.g. _Mid-Autumn in 3 weeks – forecast 15.9× recent sales · Stock covers 0.2 of
the 3 weeks needed · Holiday timing adds 5 units_. The app shows no forecast-error percentage anywhere. The
_orders from forecast_ share (accepted + adjusted ÷ decided) is held back as "not enough decisions yet" until at least
20 real decisions exist in the caller's scope.

## Management by exception

A line to order (`recommended_units > 0`) **needs review** when any rule below fires; every other line to order is
**routine**. The thresholds live in one constant, `EXCEPTION_RULES` in `server/routes/exceptions.ts`; the UI reads
them from `/api/whoami` to word its hints. Counts are for the 31 Aug 2026 order week (1,561 lines to order):

| Rule                | Fires when                                                                                                                                                       | Threshold                 | Lines |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----: |
| Peak gift at risk   | Peak gift SKU, **Order needed**, and sales lost if not ordered at or above the threshold                                                                         | `peakSalesAtRisk` $10,000 |   119 |
| Shelf-life cap      | The order was cut to what can sell before it expires (`cap_applied = SHELF_LIFE`)                                                                                | n/a                       |    29 |
| Unlike last year    | Forecast over the order's cover weeks is more than 2× or under ½ of the same **festival-aligned** weeks last year (`gold.demand_forecasts.baseline_event_naive`) | `lastYearSwing` 2         |    39 |
| Unlike recent sales | Non-peak SKU whose forecast over the cover weeks is more than 3× or under ⅓ of recent weekly sales (peak gifts ramp into a festival, so last year is their test) | `recentSwing` 3           |    46 |
| High value          | Order value at cost at or above the threshold                                                                                                                    | `highOrderValue` $10,000  |    57 |

The two swing rules skip orders under `minCasesForSwing` (2) cases. A line can match several rules: in total
**231 lines (15%) need review and 1,330 (85%) are routine** ($1.72M at cost). Raise a threshold to show fewer lines.

**Accept all routine** (`POST /api/recommendations/accept-routine`) never takes line ids from the browser. The client
sends only the filters plus the count and snapshot it showed in the confirmation (from `GET .../routine`, which
returns counts and a fingerprint of the set, not ids). The server recomputes the pending routine set from
`EXCEPTION_RULES` inside the caller's verified scope; if its count or snapshot differs from what the user saw (a
reload, someone else's decision, a different scope), it answers 409 `ROUTINE_CHANGED` with both counts and saves
nothing. Ids injected into the body are ignored, so exception lines cannot be accepted this way and a caller cannot
reach outside their scope. It is all or nothing: the recompute, the comparison and every decision + audit event run in
one transaction, and if any line cannot be accepted at write time (someone decided it a moment earlier, caught either
by the in-transaction read or by the unique `recommendation_id` on insert) the whole transaction rolls back with the
same 409.

**Accept selected** (`POST /api/recommendations/bulk-accept`, the ticked Needs review lines) sends ids with the version
each row showed and keeps per-line results: lines that pass are saved and the rest are reported (207). Both paths
apply the single-line rules to each line: verified identity,
the caller's scope (403 per line), the line exists (404), it has something to order (422) and the version the client
saw is still current (409, also when someone else decided the line a moment earlier). Each accepted line gets its own
`order_decisions` row and `decision_events` row with `decision_source = 'bulk'`. Lines that fail are returned one by
one and listed in the dialog, never dropped. The response is 200 when every line was accepted, 207 when some were
not, 403 when none are in the caller's scope; an empty or duplicate selection is 400 and a missing identity 401.

`stockout_risk = HIGH` is shown as **Order needed**: stock on hand plus inbound is below the expected demand until the
next delivery, so the line needs an order to avoid a stockout. It does not mean a stockout is already likely.
`MEDIUM` is **Below safety stock** and `LOW` is **Covered**.

## Plugins and resources

| Plugin      | Used for                                                               | Resource (`databricks.yml`)                                    |
| ----------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| `analytics` | Waste tile, forecast chart, last-year context (`config/queries/*.sql`) | `sql-warehouse` (`CAN_USE`)                                    |
| `lakebase`  | Order queue, decisions, audit trail, planner scope (`/api/*`)          | `postgres` branch + database (`CAN_CONNECT_AND_CREATE`)        |
| `genie`     | Ask Genie panel                                                        | `genie-space` (`CAN_RUN`), `user_api_scopes: dashboards.genie` |
| `server`    | Express server, static client, custom routes                           | n/a                                                            |

### Warehouse queries (`config/queries`)

| Query                | Source                                                 | Notes                                                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `forecast_vs_actual` | `gold.weekly_demand_features`, `gold.demand_forecasts` | Filters: region, channel, category, store, SKU. Reads only the **latest `forecast_run_id`**, so a rerun for the same as-of date never double-counts. `festival` names the week each festival falls in (from the weekly next-event countdown) for the chart marker. |
| `waste_kpis`         | `gold.weekly_demand_features`                          | Expired + markdown value, last 13 weeks vs a year earlier.                                                                                                                                                                                                         |

The server also runs one warehouse query of its own (`LAST_YEAR_COVER_SQL` in `server/routes/exceptions.ts`, over
`gold.replenishment_recommendations_current` and `gold.demand_forecasts`) to copy last year's festival-aligned demand
per line into Lakebase `replenishment.line_context`. It runs at startup and whenever `serving.recommendations` is
reloaded (checked every 5 minutes). The warehouse answer is validated before anything is written: an empty, missing
or malformed result fails the refresh and the previous rows stay; a valid set replaces them in one transaction. The app service principal needs `USE CATALOG` / `USE SCHEMA` and `SELECT` on these
Gold tables.

### Lakebase (`server/routes/replenishment-routes.ts`)

| Table                           | Owner                   | Purpose                                                         |
| ------------------------------- | ----------------------- | --------------------------------------------------------------- |
| `serving.recommendations`       | `eastwind-forecast` job | Current recommendations (read-only to the app)                  |
| `replenishment.order_decisions` | app service principal   | One current decision per line; `version` for optimistic locking |
| `replenishment.decision_events` | app service principal   | Append-only audit trail                                         |
| `replenishment.user_scope`      | app service principal   | Regions / stores each planner may see and decide                |
| `replenishment.line_context`    | app service principal   | Last year's festival-aligned demand per line (from Gold)        |

The app creates the `replenishment` schema at startup. Deploy once before running locally, so the service principal
owns it. The startup migration is idempotent: v2 adds `decision_source` (`'single'` or `'bulk'`, default `'single'`)
to `order_decisions` and `decision_events`, and creates `line_context`; v3 adds `acting_persona` (the "Viewing as"
persona a decision was made under, `NULL` = the decider's own scope) to both. The Gold copy
(`ml/src/sync_lakebase.py ingest_decisions`) selects named columns, so it does not carry `decision_source` yet.

### API

| Route                                      | What it does                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/whoami`                          | Verified user, effective scope (own scope narrowed by the persona), own scope, `canDecide`, `costMasked`, persona, exception thresholds                |
| `GET /api/personas`                        | Selectable personas from the UC mapping (`{enabled: false}` unless `DEMO_PERSONAS=true`)                                                               |
| `GET /api/governance`                      | Governance drawer: rows visible vs total, live row filter / mask definitions, grants, UC-evaluated row count per persona                               |
| `GET /api/filters`                         | Regions, categories and stores inside the caller's scope                                                                                               |
| `GET /api/recommendations/summary`         | KPI counts and values for the filters                                                                                                                  |
| `GET /api/recommendations/by-store`        | Top 10 stores by order need                                                                                                                            |
| `GET /api/recommendations`                 | Paged queue. Filters: region, channel, category, location, risk, status, search, peakOnly, `segment` (`EXCEPTIONS` grouped by store, `ROUTINE`, `ALL`) |
| `GET /api/recommendations/routine`         | Count, units, value and snapshot of the pending routine lines in scope + filters (no ids)                                                              |
| `POST /api/recommendations/accept-routine` | `{filters, expected: {count, snapshot}}`; server recomputes the set; 200, 207, 409 `ROUTINE_CHANGED` (nothing saved), 400, 401                         |
| `POST /api/recommendations/bulk-accept`    | `{items: [{id, expectedVersion}]}` (1-2,000) returns 200, 207 (per-line 403/404/409/422 listed), 403 (none in scope), 400, 401                         |
| `GET /api/recommendations/:id`             | Line detail and audit trail                                                                                                                            |
| `POST /api/recommendations/:id/decision`   | `{status, finalUnits?, reason?, expectedVersion}` returns 201/200, 400 (validation), 403 (out of scope), 404, or 409 (stale version)                   |

### Identity

All API routes go through `server/routes/identity.ts`. The app does not trust `x-forwarded-email` or
`x-forwarded-user` on their own. The Databricks Apps proxy forwards the signed-in user's OAuth token as
`x-forwarded-access-token` (`user_api_scopes` is set, and the platform adds `iam.current-user:read`). The server
verifies that token with the workspace (`GET /api/2.0/preview/scim/v2/Me`) and uses the identity the workspace returns,
cached for 5 minutes per token hash. Requests without a verifiable token get `401`. Scope checks and `decided_by` both
use this identity.

### Planner scope (server-side, fail-closed)

Every Lakebase read and write applies the caller's scope from `replenishment.user_scope`. The UI is never the only
filter: a client asking for another region gets nothing back, and a decision on an out-of-scope store returns `403`.
**A user with no rows sees no order lines and cannot decide.** The panel says "You don't have any stores assigned
yet"; the forecast chart stays visible.

| Row                     | Grants                                       |
| ----------------------- | -------------------------------------------- |
| `region = '*'`          | Every region and store (analysts / planners) |
| `region = 'North'`      | One region                                   |
| `location_id = 'L0022'` | One store                                    |

At startup the app seeds, idempotently (`ON CONFLICT DO NOTHING`):

- a `'*'` row for each email in `REPLENISHMENT_ANALYSTS` (`app.yaml`; currently only the app owner)
- two sample store managers: `north.manager@eastwind.example` (North region) and `daan3.manager@eastwind.example`
  (store L0022)

**Add a network-wide analyst or evaluator** with a one-line change: append their workspace email to
`REPLENISHMENT_ANALYSTS` in `app.yaml` (comma-separated, keeping the emails already listed), then redeploy.

```yaml
- name: REPLENISHMENT_ANALYSTS
  value: '<email1>,<email2>'
```

Removing an email from the list does not revoke access; delete the row (below). Without a deploy, grant directly:

```sql
-- Grant another analyst network-wide access, or limit a store manager to a region plus one store
INSERT INTO replenishment.user_scope (user_email, region, note) VALUES ('<email>', '*', 'Planner');
INSERT INTO replenishment.user_scope (user_email, region) VALUES ('<email>', 'North');
INSERT INTO replenishment.user_scope (user_email, location_id) VALUES ('<email>', 'L0022');
-- Revoke
DELETE FROM replenishment.user_scope WHERE lower(user_email) = lower('<email>');
```

The warehouse charts show aggregated history and forecasts and run as the app service principal. While viewing as a
single-region or single-store persona they are pinned to that region / store.

## "Viewing as" personas: Unity Catalog governance demo

A **Viewing as** picker in the header (with a **Governance** drawer) shows how Unity Catalog governs this data: a store
manager sees and decides only their store, an auditor sees everything and decides nothing. It is on when `app.yaml`
sets `DEMO_PERSONAS: 'true'`; with any other value the picker is hidden and the persona header is ignored.

**UC objects** (`../etl/governance/persona_rbac.sql`, idempotent; apply with
`python3 ../etl/governance/apply_governance.py --profile fe-bar`, which also prints a verification report):

| Object                                                                | What it does                                                                                                                                                                 |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `darren_fe_bar_catalog.governance.persona_access`                     | The governed mapping: persona → account group (or one explicit principal) → region `'*'` / region / store, `can_decide`, `sees_unit_cost`                                    |
| `governance.rf_store_scope(region, location_id)`                      | **Row filter** on `gold.replenishment_recommendations_current`: a row is visible when one of the caller's bindings (`is_account_group_member` or `current_user()`) covers it |
| `governance.mask_unit_cost(unit_cost)`                                | **Column mask** on `unit_cost`: `NULL` unless a binding has `sees_unit_cost` (store managers do not)                                                                         |
| `governance.persona_row_visible`, `governance.persona_sees_unit_cost` | The same rules for a named persona, so the app can show what UC returns for it                                                                                               |
| `GRANT`s                                                              | `USE CATALOG` / `USE SCHEMA` / `SELECT` to the four persona groups; the app service principal reads the mapping and the functions                                            |

| Persona (`persona_id`)                                       | Account group             | Scope       | Can                                      | Rows (of 2,247) |
| ------------------------------------------------------------ | ------------------------- | ----------- | ---------------------------------------- | --------------- |
| Head-office Analyst (`head_office_analyst`)                  | `eastwind_head_office`    | all regions | see + decide                             | 2,247           |
| Regional Planner · North (`regional_planner_north`)          | `eastwind_planners_north` | North       | see + decide                             | 782             |
| Store Manager · Zhongshan Shop L0001 (`store_manager_l0001`) | `eastwind_store_l0001`    | store L0001 | see + decide its lines; unit cost masked | 31              |
| Auditor · Read-only (`auditor`)                              | `eastwind_auditors`       | all regions | see only                                 | 2,247           |

The pipeline owner and the app's service principal have explicit network-wide `SERVICE` bindings (by principal, not
group), so the weekly MERGE and Lakebase load, the Genie space and the app's own warehouse reads keep every row.

**How the app enforces it.** The persona travels as the `x-eastwind-persona` header. The server checks it against
`persona_access` (read from UC as the service principal, cached 60 s), then:

- **never widens**: the persona's scope is intersected with the signed-in user's own `replenishment.user_scope`
  (a North planner viewing as Head-office still sees North only);
- **reads**: every list, KPI, store ranking, routine count and line detail uses that narrowed scope; cost columns UC
  masks for the persona come back `null` (shown as "Masked");
- **writes**: Accept / Adjust / Reject, Accept selected and Accept all routine use the same narrowed scope (a store
  manager deciding another store's line gets `403`, per line in a bulk accept) and a persona without `can_decide`
  gets `403 READ_ONLY_PERSONA` before any transaction;
- unknown persona `400 UNKNOWN_PERSONA`; mapping unreadable `503` (fail-closed; your own view keeps working);
- every decision and audit event records `acting_persona`. Identity (verified token), 401/404/409/422, per-line 207
  and the all-or-nothing routine accept are unchanged.

**What is UC-enforced at query time vs app-enforced.** The row filter and column mask run inside Unity Catalog for any
warehouse or Genie query on the Gold table, for whoever runs it (Genie runs as the signed-in user). The app's order
lines and decisions come from a **Lakebase copy** (`serving.recommendations`), where UC policies do not run; the app
applies the same UC mapping on the server instead. The Governance drawer puts both side by side: rows the app returns
(Lakebase) and rows UC returns for the persona (`persona_row_visible` over the Gold table). They match: 782 for North,
31 for L0001. Personas are a demo of the policy, not an impersonation: the persona's account group is not checked
against your own membership; it can only narrow what you already have.

**Admin steps (manual).** UC cannot grant to workspace-local groups, and creating account groups needs an account
admin. Create these **account** groups, add members, assign them to the workspace, then rerun the apply script (it
reports each missing group as `SKIPPED` until then): `eastwind_head_office`, `eastwind_planners_north`,
`eastwind_store_l0001`, `eastwind_auditors`. A member then sees exactly their persona's rows when they query
`gold.replenishment_recommendations_current` in SQL or Genie. Add more personas by adding rows to `persona_access`.

### 60-second demo script (UC RBAC)

1. **(0-10 s)** "Same app, same data. Viewing as **Me**: 2,247 store-SKUs, 231 lines need review." Point at the
   **Viewing as** picker.
2. **(10-25 s)** Pick **Store Manager · Zhongshan Shop L0001**. Everything re-scopes: 31 store-SKUs, 2 lines need
   review, the forecast is Zhongshan Shop's, the store filter offers one store, and unit cost shows **Masked**.
3. **(25-40 s)** Click **Governance**: role, scope Store L0001, _Can decide_, unit cost masked; rows **31 / 2,247** in
   the app and **31 / 2,247** from UC's row filter; the actual `rf_store_scope` predicate and `mask_unit_cost`, read live
   from `information_schema`; the grants on the table.
4. **(40-50 s)** Pick **Auditor · Read-only**: all 2,247 rows again, every Accept button disabled; "even if the UI were
   bypassed, the server answers 403".
5. **(50-60 s)** Pick **Regional Planner · North**: 782 rows, 82 to review. "One mapping table in Unity Catalog drives
   the row filter for SQL and Genie and the scope in this app; a persona can only narrow what you already have."

## Local development

Prerequisites: Node.js 22+, the Databricks CLI authenticated to the workspace (`databricks auth login --profile fe-bar`).

```bash
npm install
cp .env.example .env      # set DATABRICKS_CONFIG_PROFILE, warehouse, Lakebase and Genie IDs
npm run dev               # http://localhost:8000 (hot reload; runs typegen first)
```

Locally there is no proxy token. With `NODE_ENV=development` (`npm run dev`), the identity is `DEV_USER_EMAIL` from `.env`
(default `local-developer`), and that identity needs a `user_scope` row like any other user.

Checks:

```bash
npm run typecheck   # server + client tsc
npm run lint        # eslint
npm run test        # vitest: decision API, bulk accept, exception rules, order reasons, scope, identity, personas
npm run build       # typegen + server (tsdown) + client (vite)
```

## Deploy

The bundle (`databricks.yml`, target `default`, profile `fe-bar`) declares the app and its warehouse, Lakebase and
Genie resources.

```bash
databricks apps validate --profile fe-bar
databricks bundle deploy --profile fe-bar
databricks bundle run app --profile fe-bar
databricks apps get eastwind-replenishment --profile fe-bar   # app_status.state = RUNNING, url
```

Validation and browser check output is recorded in `../evidence/EVIDENCE.txt` (section 9, Databricks App).
