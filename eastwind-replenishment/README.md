# Eastwind Replenishment: demand and order control panel

A Databricks App (AppKit: React + TypeScript + Express) that planners and analysts at Eastwind Gourmet use to approve
the weekly store orders the forecast recommends. It puts the decision and its evidence on one screen:

- **KPI strip:** peak gift lines needing an order, forecast error (WMAPE) by channel, waste and markdown value,
  share of decided orders placed from the forecast, and pending decisions.
- **Order queue:** store-SKU recommendations ranked by order need, then by sales lost if not ordered. Accept in one
  click, or open the side sheet to adjust or reject with a reason. Every decision is written to Lakebase with
  optimistic locking and an append-only audit trail.
- **Forecast vs actual:** 26 weeks of actual units, the 6-week forecast with its p90 band, and the same week last year,
  for whatever the filters select (network, region, channel, category, or one store). The side sheet shows the same
  chart for a single store-SKU.
- **Order need by store:** the top 10 stores by sales at stake. Click one to drill every panel down to that store.
- **Ask Genie:** a docked natural-language panel over the curated Genie space. It runs on behalf of the signed-in user
  and shows the generated SQL.

Global filters (region, channel, category, store) live in the URL, so a filtered view can be shared. There is a
single view with drill-down and no tab pages.

`stockout_risk = HIGH` is shown as **Order needed**: stock on hand plus inbound is below the expected demand until the
next delivery, so the line needs an order to avoid a stockout. It does not mean a stockout is already likely.
`MEDIUM` is **Below safety stock** and `LOW` is **Covered**.

## Plugins and resources

| Plugin      | Used for                                                      | Resource (`databricks.yml`)                                    |
| ----------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| `analytics` | KPI, accuracy and forecast charts (`config/queries/*.sql`)    | `sql-warehouse` (`CAN_USE`)                                    |
| `lakebase`  | Order queue, decisions, audit trail, planner scope (`/api/*`) | `postgres` branch + database (`CAN_CONNECT_AND_CREATE`)        |
| `genie`     | Ask Genie panel                                               | `genie-space` (`CAN_RUN`), `user_api_scopes: dashboards.genie` |
| `server`    | Express server, static client, custom routes                  | n/a                                                            |

### Warehouse queries (`config/queries`)

| Query                 | Source                                                 | Notes                                                                                                                                                |
| --------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forecast_vs_actual`  | `gold.weekly_demand_features`, `gold.demand_forecasts` | Filters: region, channel, category, store, SKU. Reads only the **latest `forecast_run_id`**, so a rerun for the same as-of date never double-counts. |
| `accuracy_by_channel` | `gold.forecast_accuracy`                               | WMAPE for the model vs same week last year, from the latest `backtest_run_id`.                                                                       |
| `waste_kpis`          | `gold.weekly_demand_features`                          | Expired + markdown value, last 13 weeks vs a year earlier.                                                                                           |

The app service principal needs `USE CATALOG` / `USE SCHEMA` and `SELECT` on these Gold tables.

### Lakebase (`server/routes/replenishment-routes.ts`)

| Table                           | Owner                   | Purpose                                                         |
| ------------------------------- | ----------------------- | --------------------------------------------------------------- |
| `serving.recommendations`       | `eastwind-forecast` job | Current recommendations (read-only to the app)                  |
| `replenishment.order_decisions` | app service principal   | One current decision per line; `version` for optimistic locking |
| `replenishment.decision_events` | app service principal   | Append-only audit trail                                         |
| `replenishment.user_scope`      | app service principal   | Regions / stores each planner may see and decide                |

The app creates the `replenishment` schema at startup. Deploy once before running locally, so the service principal
owns it.

### API

| Route                                    | What it does                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/whoami`                        | Verified user and resolved planning scope                                                                                            |
| `GET /api/filters`                       | Regions, categories and stores inside the caller's scope                                                                             |
| `GET /api/recommendations/summary`       | KPI counts and values for the filters                                                                                                |
| `GET /api/recommendations/by-store`      | Top 10 stores by order need                                                                                                          |
| `GET /api/recommendations`               | Paged queue. Filters: region, channel, category, location, risk, status, search, peakOnly                                            |
| `GET /api/recommendations/:id`           | Line detail and audit trail                                                                                                          |
| `POST /api/recommendations/:id/decision` | `{status, finalUnits?, reason?, expectedVersion}` returns 201/200, 400 (validation), 403 (out of scope), 404, or 409 (stale version) |

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
**A user with no rows sees no order lines and cannot decide.** The panel tells them no scope is assigned; forecast and
accuracy charts stay visible.

| Row                     | Grants                                       |
| ----------------------- | -------------------------------------------- |
| `region = '*'`          | Every region and store (analysts / planners) |
| `region = 'North'`      | One region                                   |
| `location_id = 'L0022'` | One store                                    |

At startup the app seeds, idempotently (`ON CONFLICT DO NOTHING`):

- a `'*'` row for each email in `REPLENISHMENT_ANALYSTS` (`app.yaml`; currently the app owner)
- two sample store managers: `north.manager@eastwind.example` (North region) and `daan3.manager@eastwind.example`
  (store L0022)

```sql
-- Grant another analyst network-wide access, or limit a store manager to a region plus one store
INSERT INTO replenishment.user_scope (user_email, region, note) VALUES ('analyst@example.com', '*', 'Planner');
INSERT INTO replenishment.user_scope (user_email, region) VALUES ('manager@example.com', 'North');
INSERT INTO replenishment.user_scope (user_email, location_id) VALUES ('manager@example.com', 'L0022');
-- Revoke
DELETE FROM replenishment.user_scope WHERE lower(user_email) = lower('manager@example.com');
```

The warehouse charts show aggregated history and forecasts and run as the app service principal. To restrict those
per user too, add a Unity Catalog row filter on the Gold tables.

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
npm run test        # vitest: decision API validation, 409 locking, accept/adjust/reject, scope
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
