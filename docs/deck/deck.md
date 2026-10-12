# Eastwind Gourmet · Forecast-driven replenishment

Business deck, text export. It contains nine slides with speaker notes, a demo-setup opener, a live demo run-of-show, and a reading-the-room Q&A sheet. The visual version is `index.html` and `eastwind-deck.pdf`. Every figure comes from `evidence/EVIDENCE.txt` (cited as E§section) or `industry-problem.md`. All data is synthetic (seed 42).

**In the room**
- **VP Merchandising** (executive sponsor): owns lost sales, waste, and margin. Stay at outcome altitude: dollars, shelves, and manager trust.
- **CIO** (domain owner): must unify fragmented data and put an explainable forecast into ordering. Go one level deeper on request: pipeline, governance, MLOps, security.

**The story in one line:** one Databricks platform turns five siloed feeds into a trusted weekly order, so you recover lost sales on peak gifts without a stitched-together stack.

---

## Demo setup opener (30–45 seconds)

> "Thanks for the time. Eastwind runs about 80 stores in three formats: downtown shops, highway kiosks, and airport stores. The same gift box sells very differently in each, and holiday peaks make it harder. Today your managers order from experience, and that costs you both ways: about $17.8M a year in lost sales from empty shelves, and $3.87M a year in expired and marked-down stock.
>
> In the next 20 minutes I'll show you three things. First, the outcome: a conservative target of $2–3M a year in recovered sales. Second, the store manager's screen, where a forecast turns into an order they can approve in one click. Third, how it all runs on one Databricks platform, governed end to end.
>
> [VP name], I'll keep us on outcomes. [CIO name], I'll go as deep on the architecture as you want. Let's start with what you get."

---

## Slide 1 · Forecast-driven replenishment

**Eastwind Gourmet · Specialty food retail**

You can’t forecast a gift box for a highway kiosk the way you do downtown.

For the VP Merchandising and the CIO · October 2026

**Speaker notes**
- **TELL:** "This is about one decision your managers make every week: how much to order."
- **SHOW:** The one-liner. Three store formats, one gift box, three demand patterns, and holidays on top.
- **TELL:** "Get that decision right on peak gifts and you recover sales. Get it wrong and you lose both ways."

---

## Slide 2 · The outcome: what you get

| Tile | Value | What it means | Proof |
|---|---|---|---|
| Lost sales recovered (target) | **$2–3M/yr** | 10–15% of today's $17.8M/yr lost sales | Conservative: the peak-season backtest cut modelled lost sales in every channel and every holiday window |
| Plan-for coverage | **91–92%** | of store-SKU-weeks land within the p90 plan-for quantity | The calibrated p90 band drives safety stock, so you know how much buffer you're buying |
| One platform | **1** | platform from ingestion to ML, apps, and Gen AI | 6 capabilities on Databricks, one security and lineage model, fewer vendor handoffs |

- **VP Merchandising:** fuller shelves on peak gifts, and orders your managers trust.
- **CIO:** one governed platform from POS to order, traceable end to end.

**Speaker notes**
- **TELL:** "Three numbers, in your terms."
- **SHOW:** The target is $2–3M a year of recovered sales, which is 10–15% of the $17.8M you lose today. Demand landed within the plan-for quantity in 91–92% of store-SKU-weeks, so safety stock is calibrated rather than guessed. And it all runs on one platform: ingestion, governance, ML, operational serving, Genie, and the app.
- **TELL:** "We kept the target conservative on purpose. The peak-season backtest points higher, and I'll show you why we don't quote it as the headline."

---

## Slide 3 · The problem: ordering by gut feel

**80 stores, 3 channels, one gift box that sells three ways**
- Downtown: 32 stores
- Highway: 26 kiosks
- Airport: 22 stores

Managers order from experience. Holiday peaks make the swings larger.

**You lose both ways**
- **$17.8M** lost sales a year from stockouts
- **$3.87M** expired and marked down a year

**Peaks amplify it:** 18.7–21.1% of peak-gift store-days stocked out in Mid-Autumn 2025, vs 8.6% overall. Peak gifts carry 57.5% of lost sales.

**Speaker notes**
- **TELL:** "Here's where the money leaks."
- **SHOW:** $17.8M a year in lost sales and $3.87M a year in waste. The leak is worst at peaks: about one in five peak-gift store-days was out of stock in Mid-Autumn 2025, and peak gifts carry 57.5% of all lost sales.
- **TELL:** "So the prize is peak gifts. That's where we focused the forecast."

---

## Slide 4 · Why it’s hard (for the CIO)

1. **Five siloed sources:** POS, ERP inventory, product catalog, store master, holiday calendar. Each has its own owner, format, and refresh cycle. Even store IDs differ: `DT001` vs `L0001`.
2. **Stockouts hide demand.** When the shelf is empty, sales stop, so history understates what customers wanted. One mooncake line was out of stock 6 and 7 days in its two peak weeks.
3. **Festivals move.** Lunar holidays land in a different week each year, so "same week last year" points at the wrong week. Mid-Autumn fell on Sep 17 in 2024 and Oct 6 in 2025.
4. **Stitched-together stack:** separate ETL tool, warehouse, ML platform, OLTP database, BI/chat tool, and app hosting. Every hop adds a data copy, a handoff, and another set of permissions to keep in sync.

**Speaker notes**
- **TELL:** "Four reasons this hasn't been solved with a spreadsheet or another point tool."
- **SHOW:** The five feeds don't share keys. Sales history undercounts demand exactly when shelves are empty. Festivals move, so last year's week is the wrong week. And the usual answer, six tools wired together, means copies and handoffs between vendors, each with its own permission model.
- **TELL:** "The first three are data and modelling problems. The fourth is a platform problem, and it's what makes the first three expensive to fix. The next slide addresses all four."

---

## Slide 5 · Architecture: one platform, end to end

Raw files (POS sales, ERP inventory, product catalog, store master, holiday calendar) feed one **Databricks Data Intelligence Platform** band:

- **Lakeflow:** bronze, silver, gold; expectations and quarantine
- **ML + MLflow:** LightGBM forecast, @champion gate, p90 band
- **Lakebase:** orders and manager decisions, audit trail
- **Genie Agent:** plain-language questions, runs as the user
- **Databricks App:** managers review and approve orders
- **Unity Catalog, one governance layer under everything:** permissions, lineage, and audit across every step
- **Loop:** decisions flow back to gold.
- Band label: one governed data flow.

One weekly job refreshes data, scores the @champion model, builds orders, loads Lakebase, and ingests decisions.

**Speaker notes**
- **TELL:** "One platform, not a chain of vendors."
- **SHOW:** Raw files land in Lakeflow and are refined bronze to silver to gold, and bad rows are quarantined. The forecast trains on gold, is tracked in MLflow, and serves only once it passes the @champion gate. Orders and manager decisions live in Lakebase, the operational database, with an audit trail. Genie and the app sit on the same data. Unity Catalog runs underneath all of it: one set of permissions, one lineage graph.
- **TELL:** "For you, [CIO], that means one platform to govern and operate: no vendor-to-vendor copies, fewer handoffs, and one security and lineage model. Every recommended order traces back to the POS and ERP rows behind it."

---

## Slide 6 · How it works: pain point to result

| Pain point | Databricks capability | Result |
|---|---|---|
| Fragmented data | Lakeflow + Unity Catalog: one governed view | 0 mismatched weeks; 40 bad rows quarantined |
| Hidden demand | Stockout-aware training | Weeks distorted by empty shelves kept out of training |
| Holiday swings | Festival-aligned features | Forecast peaks in the lead-up weeks to the festival |
| Distrust | Reasons in units, plus a p90 band on every line | Peak-gift demand within p90 in 90–95% of weeks |
| Slow decisions | One-click approve in the App, on Lakebase | Accept, adjust, or reject with a reason, all audited |
| Ad-hoc questions | Genie Agent on governed gold tables | 11 of 11 benchmark questions correct, SQL shown |

**Every row runs on one platform: same data, same permissions, no vendor-to-vendor copies.**

**Speaker notes**
- **TELL:** "Each pain point maps to one capability and one result, all on the same platform."
- **SHOW:** Gold reconciles to source with zero mismatched weeks. Training skips weeks where empty shelves distort demand. Festival-aligned features move the forecast peak to the lead-up weeks, which is when customers actually buy. Every line carries its reason and a p90 band. Managers approve in one click, and Genie answers planners' questions with the SQL shown.
- **TELL:** "Trust is the adoption lever. If managers can see why, they order from it."

---

## Slide 7 · The app: what managers see

Screenshot of the deployed Databricks App (control panel), with three callouts:
1. **KPI strip:** peak gifts at risk, waste, and adoption at a glance.
2. **Order queue:** ranked by sales at risk. Accept in one click, or adjust with a reason. (Inset: the decision panel with Accept, Save adjusted quantity, and Reject.)
3. **Ask Genie:** plain-language questions, answered with your access and the SQL shown.

**Speaker notes**
- **TELL:** "Now the store manager's Monday morning. I'll show it live."
- **SHOW:** Switch to the live app and follow the run-of-show below.
- **TELL:** "One screen to review, understand, and approve. That's 'what good looks like' from your own brief."

---

## Slide 8 · Impact and proof: proven vs next

| Success measure | Evidence | Status | Next |
|---|---|---|---|
| Forecast accuracy by channel | Beats today's method in every channel and both holiday seasons (see build evidence, section 5) | Proven | Track live by channel |
| Stockouts on peak gift SKUs | Modelled lost sales down in every window and channel (baseline: 18.7–21.1% of peak-gift days out) | Simulated | Measure in the pilot |
| Expired and marked-down value | Flat: +$42k/yr in the backtest (baseline: $3.87M/yr) | Not yet | Waste-aware policy, phase 2 |
| Orders placed from forecast | Test decisions only so far | Not yet | Track in the pilot |

**Peak-season backtest: $26.8M/yr** of lost sales avoided vs manual ordering, pooled across 25 holiday weeks. This figure is annualised from peak windows only and isn't a whole-year estimate. It shows the $2–3M/yr target is conservative.

The policy backtest is a simulation on synthetic data. A full-year replay comes before any finance claim.

**Speaker notes**
- **TELL:** "Here's what's proven and what isn't yet. I'd rather you hear the gaps from me."
- **SHOW:** The forecast beats today's method in every channel and both holiday seasons. On stockouts, the simulation cut modelled lost sales in every holiday window and channel. Pooled across 25 peak weeks, that annualises to $26.8M, but it's peak weeks only, so we don't quote it as a yearly number. Waste is flat today (+$42k a year), which is why waste-aware ordering is phase 2. Adoption so far is test decisions only.
- **TELL:** "Accuracy is proven, stockout value is strongly indicated, and the pilot measures the rest on your real data."

---

## Slide 9 · Roadmap: 30 / 60 / 90 days

- **Day 30, governance pack:** row filters by region, column masks on cost, persona groups, lineage in UC.
- **Day 60, waste-aware ordering:** add shelf-life and waste limits to the order rule; replay a full year.
- **Day 90, one-region pilot:** managers order from the app; you measure all four success measures live.

**The ask: approve a one-region pilot.** You get live proof on stockouts, waste, and adoption before a network-wide rollout.

**Speaker notes**
- **TELL:** "Here's how we go from backtest to proof in your stores."
- **SHOW:** In 30 days, close the governance gaps. In 60 days, make ordering waste-aware and replay a full year. By day 90, run a one-region pilot that measures all four success measures live.
- **TELL:** "The ask is a one-region pilot. It's small, reversible, and it gives you real numbers before you scale."

---

## Live demo run-of-show (control panel + Genie, about 8 minutes)

Each beat is TELL (what you're about to show) → SHOW (the click) → LAND (what it means for the business). Live values come from the latest weekly run (E§9). Read them off the screen rather than from this script.

| # | TELL | SHOW | LAND (business meaning) |
|---|---|---|---|
| 1 | "This is the one screen a manager opens on Monday." | Control panel with all regions selected. Point to the order-week and model stamp in the header. | One place, refreshed weekly by a single job, with no exports or spreadsheets. |
| 2 | "First: what's at risk this week." | KPI strip. Peak gifts needing an order (latest run: 481 of 908 peak lines, $3.60M of peak sales at risk, E§9), waste and markdown, and orders placed from forecast. | You see exposure in dollars before anyone places an order. |
| 3 | "Next: where demand is heading." | Forecast vs actual chart. Point to the p90 band widening into the Mid-Autumn lead-up weeks. | You plan for the peak before it hits, with a buffer sized to the risk. |
| 4 | "Now: which stores need you most." | Order need by store, then click a store to drill down. | Managers start with the lines that lose the most sales. |
| 5 | "Here's why a manager can trust a line." | Open a line in the order queue. Show the reason (e.g. "Mid-Autumn Festival 2026 in 3 weeks; capped by 30-day shelf life", E§6), on hand plus inbound, p90, and expected expiry. | The forecast explains itself in units, which is what drives adoption. |
| 6 | "The manager stays in control." | Accept in one click, or adjust (e.g. 672 → 600, "Display space limited during renovation", E§7). Point out that a reason is required. | Every decision is versioned and audited, and flows back to gold for the next forecast. |
| 7 | "Planners can just ask." | Ask Genie: "Which highway stores face the highest Mid-Autumn stockout risk?" Open the SQL attachment. (In testing the top store was Taian Service Area N, 6 SKUs, $56,791, E§8.) | Self-serve answers on governed data, running as the user, with the SQL visible. |
| 8 | "Let me bring it back to your KPIs." | Return to the KPI strip. | Fewer empty shelves on peak gifts, managers who order from the forecast, and one platform the CIO can govern. |

**CIO aside (use if asked during beats 6–7):** the app checks each user's OAuth token, so headers can't be spoofed. It applies a server-side scope that blocks access by default: a North manager gets 403 outside North. A stale edit returns 409 "Someone else changed this order" (E§7, E§9).

**Before the demo:** clear the 3 test decisions (L0008, L0022, L0026) from Lakebase and gold (E§11).

---

## Reading the room: Q&A sheet

Give the exec answer first. Add the technical answer if the CIO asks, or if the VP wants proof.

### VP Merchandising

**1. What does it cost?**
- *Exec:* It runs on one platform to govern and operate, with fewer vendor handoffs to build and maintain. We'll size the pilot with you; this build doesn't include a cost figure.
- *Technical:* The pipeline, SQL warehouse, and Lakebase run serverless or autoscaling (E§3, E§7). The weekly scoring job ran in about six minutes (E§5).

**2. What's the risk?**
- *Exec:* Managers stay in control: every line can be accepted, adjusted, or rejected with a reason, and every change is audited. We start with one region.
- *Technical:* The audit trail is append-only. Scope blocks access by default, and unmapped users see nothing (E§7, E§9). The model only serves after the @champion gate (E§5).

**3. How fast do we see value?**
- *Exec:* The end-to-end flow already runs weekly. The 30/60/90 plan gets one region ordering from it within 90 days.
- *Technical:* One weekly job covers refresh, scoring, recommendations, the Lakebase load, and decision ingest, and every task succeeded on the last run (E§5).

**4. Will managers actually use it?**
- *Exec:* That's why every line explains itself in units and shows a p90 band, and why approval is one click. To be honest, we only have test decisions so far. The pilot measures adoption.
- *Technical:* 3 test decisions so far: 1 accepted, 1 adjusted, 1 rejected (E§10). The share placed from the forecast is reported in the app as decisions accumulate.

**5. What's the ROI?**
- *Exec:* You lose $17.8M a year today. Our target is to recover 10–15% of that, $2–3M a year. The peak-season backtest suggests more, but we won't promise it until a full-year replay confirms it.
- *Technical:* Pooled peak-window backtest: $26.8M/yr annualised from 25 holiday weeks. It's explicitly not a whole-year estimate (E§6).

**6. What about waste?**
- *Exec:* Today it's roughly flat (+$42k a year in the backtest), because the plan-for policy buys availability. Cutting the $3.87M a year of waste is phase 2: waste-aware ordering.
- *Technical:* The p90 order-up-to rule doesn't yet include waste constraints. The ~$1M waste saving in the brief isn't demonstrated yet (E§6, E§10).

### CIO

**1. What's the architecture?**
- *Exec:* One Databricks platform, from ingest to app, with Unity Catalog underneath.
- *Technical:* A serverless Lakeflow pipeline with 5 bronze Auto Loader streaming tables, 6 silver and 2 gold materialized views (E§3). A LightGBM Tweedie mean model plus a quantile(0.9) model on 29 features, registered in UC with an @champion alias (E§5). Lakebase Postgres 17 for recommendations and decisions (E§7). An AppKit app and a Genie space on 8 governed tables (E§8, E§9).

**2. How do you handle data quality?**
- *Exec:* Bad rows are caught and quarantined automatically, and gold reconciles to source exactly.
- *Technical:* Expectations quarantined exactly the planted defects: 20 unknown-store rows and 20 negative-unit rows. 0.3% duplicates collapse to one row. Gold reconciles to source with 0 mismatched weeks in all three channels (E§2, E§3).

**3. Security and governance?**
- *Exec:* There's one permission and lineage model across every step. Some fine-grained controls are next on the roadmap.
- *Technical:* Today: least-privilege grants for the app service principal, and lineage captured (577 lineage rows). The app verifies the user's token, and Genie runs as the user (E§4, E§9). **Not built yet:** row filters, column masks (unit cost is visible to gold readers), persona groups, and UC column comments. That's the day-30 governance pack (E§4, E§11).

**4. How does it integrate with our POS and ERP?**
- *Exec:* Your systems keep running. They drop files, and Lakeflow picks up only what's new.
- *Technical:* Auto Loader ingests incrementally; two drops added exactly +12,079 POS and +15,729 inventory rows (E§3). The store master bridges POS `store_code` to ERP `location_id` (E§2). For production, direct connectors are an option to scope in the pilot.

**5. Will it scale?**
- *Exec:* It already forecasts every store and SKU, every week, on serverless compute.
- *Technical:* 2,247 store-SKU series, 1,860,102 training rows, and 13,482 forecast rows per weekly run (E§5). Training took about 25 minutes and scoring about 6 minutes (E§5).

**6. How do you handle model drift and MLOps?**
- *Exec:* Every model is versioned, gated before it serves, and checked against its features before every run.
- *Technical:* There's an MLflow experiment and a UC model registry with an @champion alias and a promotion gate. The scoring job asserts a feature-schema hash before it writes forecasts (E§5). We backtest with rolling origins on two holiday folds. Known gaps: stockout weeks are excluded rather than demand-corrected, the model still dampens some festival-week peaks, and live drift monitoring is next (E§11).

### Objection handling

- **"We already have a BI tool and a data warehouse."** Keep them. This isn't a BI replacement; it's the forecast-to-order loop your BI can't close. Gold tables are open to your BI through a SQL warehouse, and you avoid adding vendor-to-vendor copies for ML, an OLTP database, and an app host.
- **"Why not buy a point forecasting SaaS?"** A SaaS forecast is another copy of your data, another permission model, and a black box your managers won't trust. Here the festival logic is yours, every order traces to its source rows, and manager decisions flow back to improve the next forecast, all under Unity Catalog.
- **"These numbers are synthetic."** Yes, and we say so on the slides. The synthetic business is calibrated to realistic magnitudes ($160.8M net sales, $17.8M lost sales, $3.87M waste a year, E§2). That's exactly why the ask is a one-region pilot: to measure on your real data before any finance claim.
- **"$26.8M sounds too good."** Agreed, which is why it isn't our headline. It annualises the two most stressed holiday windows. We commit to $2–3M and let the pilot and a full-year replay decide the rest.
