# Eastwind Gourmet: forecast-driven replenishment

**Customer:** Eastwind Gourmet, a regional specialty food retailer with 80 stores in three formats (32 downtown shops, 26 highway service-area kiosks, 22 airport stores).
**Industry:** F&B / specialty retail.
**Data:** synthetic (seed 42); no real customer data.

Eastwind loses **$17.8M a year to empty shelves**, and **$10.3M** of that (57.5%) is on peak gift SKUs such as mooncake boxes. Store managers order "same week as last year", but lunar festivals move: Mid-Autumn fell on 17 Sep in 2024 and 6 Oct in 2025. So the stock arrives for the wrong week. This build forecasts demand by store, SKU, channel and week, turns the forecast into a recommended order, and gives managers one app to approve it.

| Outcome | Value | Status |
|---|---|---|
| Peak-gift lost sales to win back | **$2–3M/yr** (20–30% of $10.3M) | Target. Modelled lost sales fell in 6 of 6 holiday backtest windows |
| Manager time | **~15%** of order lines need a decision (231 of 1,561); the rest are accepted as one routine batch | Live in the app |
| Peak-gift sales flagged before the week starts | **$3.6M** at risk; 481 of 908 peak lines need an order this week | Live in the app |
| Expiry + markdown guardrail ($3.87M/yr) | Held flat (~$42k/yr lower in the backtest) | Guardrail, no saving claimed |
| Forecast accuracy (technical) | WMAPE 23.6–26.6% by channel vs 38.1–47.7% for last-year-same-week | Backtest, two holiday folds |

Execution evidence (run IDs, query results, API responses, test output) is in **[`evidence/EVIDENCE.txt`](evidence/EVIDENCE.txt)**. The business deck is [`docs/deck/eastwind-deck.pdf`](docs/deck/eastwind-deck.pdf), with speaker notes in [`docs/deck/deck.md`](docs/deck/deck.md).

---

## What is the business challenge you are solving?

Eastwind Gourmet has no reliable demand forecast. Store and channel managers order from experience, but the same gift box sells very differently downtown, at a highway kiosk and at an airport, and holiday peaks move every year with the lunar calendar. Ordering by last year's calendar week stocks the shelf for a festival that has already moved. In Mid-Autumn 2025, 18.7–21.1% of peak-gift store-days were out of stock, against 8.6% across all products.

The business loses both ways. Popular gift SKUs sell out in peak season, which costs **$17.8M a year in lost sales, $10.3M of it on peak gifts**. Short-dated products are over-ordered at other times and expire or get marked down, which costs **$3.87M a year**.

Two stakeholders own this:
- **VP Merchandising** owns lost sales, waste and margin. They want fuller festival shelves without more waste, and managers spending time only on the orders that need judgment.
- **CIO** has the data spread across five systems with different owners, formats, refresh cycles and even store IDs (POS uses `DT001`, ERP uses `L0001`). There is no single governed view of demand to forecast from, and no way to put a forecast inside the ordering process.

## How does your Databricks solution address this challenge?

One governed data flow on the Databricks Data Intelligence Platform, from raw source files to an approved order, with manager decisions flowing back for analysis.

1. **Lakeflow (unify).** Auto Loader ingests five feeds (POS, ERP inventory, product catalog, store master, holiday calendar) incrementally into Bronze. Silver reconciles store IDs and applies expectations: exactly the 40 planted defects (unknown store, negative units) go to quarantine. Gold `weekly_demand_features` reconciles to source with 0 mismatched weeks in every channel.
2. **ML (predict).** A LightGBM model forecasts weekly demand for 2,247 store-SKUs, six weeks ahead. Its features line this year up with last year's *festival*, not last year's calendar week. A calibrated p90 band sizes safety stock for the peak. It's tracked in MLflow and registered in Unity Catalog as `ml.eastwind_demand@champion`, with a gated promotion step. A weekly job scores the champion and builds the recommended order for each line (`gold.replenishment_recommendations_current`), with plain-word reasons ("Mid-Autumn in 3 weeks; capped by 30-day shelf life").
3. **Lakebase (decide).** Recommendations are served from Lakebase Postgres to the app. Manager decisions (accept, adjust, reject with a reason) are written back with optimistic locking and an append-only audit trail, then copied to Gold. That lets "share of orders placed from the forecast" be measured.
4. **Unity Catalog (govern).** One catalog, with one schema per layer. Least-privilege grants for the app's service principal, and lineage from every recommendation back to the raw POS and ERP feeds. A **row filter** limits each persona to their stores or region (2,247 / 782 / 31 rows for head office, the North planner and one store manager), and a **column mask** hides unit cost from store managers. Both are driven by one mapping table that the app also applies to its Lakebase reads.
5. **Genie Agent (ask).** A curated Genie space over 8 governed tables, so planners can ask "Which highway stores face the highest Mid-Autumn stockout risk?" in plain language. It runs as the signed-in user, so the UC filter applies, and it shows the SQL it generated. It has 16 benchmark questions.
6. **Databricks App (act).** A single control panel ([live](https://eastwind-replenishment-7474660797782218.aws.databricksapps.com), workspace login required):
   - four KPI tiles
   - an exception queue: only the ~15% of lines a rule flags need a manager; the routine rest are accepted in one all-or-nothing step
   - forecast vs actual with the p90 band and festival markers
   - store drill-down
   - a docked Genie panel
   - a "Viewing as" persona switch that shows the governance in action

---

## Architecture

```
POS · ERP inventory · Product catalog · Store master · Holiday calendar   (CSV drops → UC volume)
        │
        ▼
Lakeflow:  Bronze (Auto Loader) → Silver (expectations, quarantine) → Gold features + KPIs
        │
        ▼
ML:        LightGBM mean + calibrated p90 → @champion in UC → weekly scoring → Gold recommendations
        │                                                         │
        ▼                                                         ▼
Lakebase:  serving.recommendations ──► Databricks App ◄──► Genie Agent (Gold, as the user)
                                         │
           replenishment.* decisions ◄───┘  → copied back to Gold
        ───────────────────────────────────────────────────────────────────────────
Unity Catalog underneath: grants, lineage, row filter (store/region), column mask (unit cost)
```

A visual version is in [`docs/architecture.html`](docs/architecture.html).

## Repo map

| Path | What it is |
|---|---|
| `src/data_generation/generate.py` | Synthetic sources: true demand first, then censored by a simulated manual ordering policy. Ground truth is written separately for evaluation only |
| `etl/` | Lakeflow bundle `eastwind-etl`: Bronze → Silver → Gold pipeline |
| `etl/governance/` | UC row filter, column mask, persona mapping (`persona_rbac.sql`) and the apply-and-verify script |
| `ml/` | Bundle `eastwind-ml`: training with a gated promotion step, weekly scoring, recommendations, Lakebase sync, decision ingest |
| `genie/` | Genie space builder, serialized space and benchmark checks |
| `eastwind-replenishment/` | Databricks App (AppKit: React + TypeScript + Express), 73 tests. See its [README](eastwind-replenishment/README.md) |
| `docs/` | Business deck (PDF, HTML, speaker notes) and architecture diagram |
| `evidence/EVIDENCE.txt` | Text evidence the build ran, one section per stage |

## Decisions and trade-offs

- **Festival-aligned features instead of lag-52.** Matching each week to the same number of days before last year's festival fixes the core business problem. A plain seasonal model under-forecasts peak gifts by 30–39%; this one gets that down to 6–9%.
- **Sold-out weeks are excluded from training.** When the shelf is empty, sales stop, so sold-out history understates demand. Excluding those weeks is simple and safe. Estimating the demand that went unmet (a censored-demand model) is the next step.
- **A p90 band with conformal calibration for safety stock.** It buffers the risky festival weeks without inflating the point forecast. Coverage on peak-gift rows rose from 81–84% (raw) to 90–95% (calibrated).
- **Gated model promotion.** A new model replaces the champion only if it beats it. A feature-schema change needs an explicit override flag. The weekly scoring job never retrains, and checks that the model and feature schema match before writing.
- **Management by exception.** Managers review only the lines a rule flags; everything else is one routine batch. This moves manager time to where judgment matters, which is how a forecast actually gets adopted.
- **No forecast-error percentages in the app or deck.** Business users see orders, reasons and dollars at risk. Accuracy stays in the technical evidence.
- **Lakebase loaded by an idempotent upsert, not a synced table.** Synced tables need a Lakebase UC catalog that this workspace can't create. The upsert gives the same result, and the app wouldn't change if it moved to synced tables.
- **One UC mapping for both UC and the app.** UC enforces the row filter and mask for SQL and Genie. The app reads Lakebase, where UC filters don't run, so it applies the same `persona_access` mapping server-side. That gives one source of truth for who sees what.
- **Genie as the Gen AI component.** A curated space with column descriptions, synonyms, join specs and checked benchmark SQL, rather than a free-form LLM over raw tables. It's governed, it shows its SQL, and it's testable.
- **The value claim is kept honest.** $2–3M/yr is a target (20–30% of peak-gift lost sales). The backtest shows the direction: lower modelled lost sales in every holiday window, with waste held flat. A full-year replay comes before any finance figure.

## Running it

Workspace profile `fe-bar`, catalog `darren_fe_bar_catalog`.

```bash
uv run src/data_generation/generate.py --out <landing_dir> --truth <truth_dir>   # then upload to the raw.landing volume
(cd etl && databricks bundle deploy -p fe-bar)                                    # Lakeflow pipeline
python3 etl/governance/apply_governance.py --profile fe-bar                       # UC row filter, mask, persona mapping
(cd ml && databricks bundle deploy -p fe-bar)                                     # training + weekly scoring jobs
python3 genie/build_space.py --check --deploy                                     # Genie space + benchmarks
(cd eastwind-replenishment && databricks bundle deploy -p fe-bar)                 # Databricks App
```
