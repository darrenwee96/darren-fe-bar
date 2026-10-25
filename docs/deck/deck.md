# Eastwind Gourmet · Forecast-driven replenishment

Business deck, text export. This file holds:
- the demo-setup opener
- the nine slides with TELL / SHOW / TELL notes
- the 8-beat live demo run-of-show and a demo-prep checklist
- the reading-the-room Q&A sheet, with a backup section

The visual version is `index.html` and `eastwind-deck.pdf`. The architecture diagram also stands alone as `docs/architecture.html`.

**Sources:** business figures come from `evidence/EVIDENCE.txt` (section numbers are the stable reference). All data is synthetic (seed 42). The slides speak in business and technical objectives; build-level detail (row counts, model versions, test results) stays in the evidence file and the Q&A backup.

**In the room**
- **VP Merchandising** (executive sponsor): owns lost sales, waste, and margin. Stay at outcome altitude: dollars, shelves, and manager time.
- **CIO** (domain owner): must unify fragmented data and put an explainable forecast into ordering. Go one level deeper on request: pipeline, governance, MLOps, security.

**Storyline: problem first, then how Databricks helps.**
1. **The business problem (slides 2–3).** Festivals move every year, orders follow last year's calendar, and the shelves are empty when customers arrive. The data to fix it sits in five systems.
2. **How Databricks helps (slides 4–5).** Three business objectives for the VP, three technical objectives for the CIO, and one governed platform that delivers them.
3. **What it looks like (slides 6–8).** Right quantity in the right week; managers review only the exceptions; anyone can ask, and everyone sees only their own stores.
4. **What changes (slide 9)** and the next step.

---

## Demo setup opener (30–45 seconds)

> "Today Eastwind orders festival gifts for the week the festival fell last year. So shelves run empty before Mid-Autumn and fill up after it.
>
> Across your 80 stores that costs about $17.8M a year in lost sales, and $10.3M of it is on peak gifts.
>
> I'll start with that problem and why it's hard to fix today. Then I'll show how Databricks helps: what this project sets out to deliver for each of you, and the platform behind it. Then the app your managers would use on Monday, live.
>
> [VP name], I'll keep us on outcomes. [CIO name], stop me anywhere and I'll go as deep as you want."

---

## Slide 1 · Forecast-driven replenishment

**Eastwind Gourmet · From a Monday guess to a Monday order**

Order festival gifts for the week the festival falls, not the week it fell last year.

Prepared for your VP Merchandising and CIO · October 2026

**Speaker notes**
- **TELL:** "This is about one decision your managers make every Monday: how much to order."
- **SHOW:** The one-liner. Lunar festivals move every year, and ordering by last year's calendar week misses them.
- **TELL:** "Get that one decision right on peak gifts and you win sales back."

---

## Slide 2 · The business problem: festivals move, orders don't

- **$17.8M/yr** lost sales from empty shelves across your 80 stores
- **$10.3M/yr** of that on peak gifts, the products customers buy for festivals
- **1 in 5** peak-gift shelves empty at Mid-Autumn, more than twice the usual rate

**Chart: one store, one mooncake box, Mid-Autumn 2025.** Stocked for 2024's peak, out of stock for 2025's. Mid-Autumn fell on Sep 17 in 2024 and Oct 6 in 2025, so ordering by last year's calendar week stocked this line for the wrong week.

**Speaker notes**
- **TELL:** "Here's where your money leaks, and why."
- **SHOW:** $17.8M a year in lost sales, $10.3M of it on the gifts customers buy for festivals. Then one line from one store: the order followed 2024's peak week, customers came two weeks later, and the shelf was empty for most of the festival fortnight.
- **TELL:** "That isn't a bad manager. It's the calendar. The festival moved and the order didn't."

---

## Slide 3 · Why it's hard today: three things in the way

1. **Fragmented feeds.** POS, ERP inventory, product catalog, store master and holiday calendar each have their own owner, format and refresh cycle; even the store IDs differ. *What it costs you:* no single view of demand, so every forecast starts from a spreadsheet.
2. **Stockouts hide demand.** When the shelf is empty, sales stop, so history records what sold, not what customers wanted. *What it costs you:* history understates the peak, so next year's order is short again.
3. **The usual fix: six tools.** ETL tool, warehouse, ML platform, OLTP database, BI/chat, app hosting. *What it costs you:* slow, costly projects, and access rules that drift apart.

**Speaker notes**
- **TELL:** "Three reasons this is harder than it looks."
- **SHOW:** The data doesn't line up across systems. The history is wrong exactly when it matters, because empty shelves record zero sales. And the usual answer is a chain of six tools, each with its own copy of the data and its own permissions.
- **TELL:** "So the question isn't just 'can we forecast'. It's 'can we get a trusted forecast into the order, on data the CIO can govern'. That's what Databricks is for."

---

## Slide 4 · How Databricks helps: what this project delivers

**Business objectives · VP Merchandising**

| Objective | Target | How |
|---|---|---|
| Win back peak-gift sales | **$2–3M/yr** (20–30% of today's peak-gift lost sales) | Holiday-aware forecast: order for the week the festival falls |
| Manager time where it matters | **~15%** of order lines need a decision | Exception-based ordering app; the routine rest accepted in one step |
| No extra waste | Expiry and markdowns held **flat** | Buffers capped by shelf life |

**Technical objectives · CIO**

| Objective | How | Products |
|---|---|---|
| One governed view of demand | Five source systems unified and quality-checked in one place | Lakeflow · Unity Catalog |
| An explainable forecast inside ordering | Each recommended order reaches the manager with its reasons; every decision is recorded | Mosaic AI · Lakebase · Databricks Apps |
| Self-service without new risk | Plain-language questions, with the same permissions in the app, SQL and Genie | Genie · Unity Catalog |

**Speaker notes**
- **TELL:** "Here's what this project sets out to deliver, for each of you."
- **SHOW (VP):** $2–3M a year is the target: winning back 20–30% of what you lose on peak gifts today. Your managers look only at the lines that need judgement, about one in seven. And we hold waste flat, because the extra buffer never exceeds what the shelf life allows.
- **SHOW (CIO):** One governed view of demand across your five systems. A forecast that arrives inside the ordering process with its reasons, and a record of every decision. And self-service questions that respect the same permissions everywhere.
- **TELL:** "Next, the platform that delivers all six on one governed data flow."

---

## Slide 5 · How Databricks helps: one governed platform, from source to order

Proposed architecture, left to right:

| Column | Products | Role |
|---|---|---|
| **Eastwind source systems** | POS sales, ERP inventory, product catalog, store master, holidays | Your systems keep running as they are |
| **Data ingestion** | Lakeflow Connect; Auto Loader on UC Volumes | Managed CDC from the POS and ERP databases; catalog, store and holiday files load incrementally |
| **Lakehouse · Medallion** | Bronze → Silver → Gold, built by Lakeflow Spark Declarative Pipelines | Raw history → cleansed and conformed (store IDs matched) → weekly demand by store, product and channel. Quality checks quarantine bad records before they reach the forecast |
| **Intelligence · Serving** | Mosaic AI · MLflow; Lakebase; Databricks SQL | Holiday-aware forecast with a risk buffer; orders to approve and manager decisions in Postgres; a serverless warehouse on Gold. Decisions flow back to Gold (dashed arrow) |
| **Business users · AI agents** | Databricks App; Genie Agent | Review exceptions and approve orders; ask questions in plain language on governed data |

- **Unified governance band:** Unity Catalog for access control, row filters and column masks, lineage, auditing and the model registry.
- **Orchestration band:** Lakeflow Jobs runs the weekly cycle (refresh data → forecast → recommend orders → serve to the app) on Delta Lake and serverless compute.

**Speaker notes**
- **TELL:** "Left to right is your data's journey, from your five systems to an approved order. Underneath are the two things that hold it together: one governance layer and one scheduler."
- **SHOW (business altitude, ~45 s):** Your systems keep running. Lakeflow brings their data in and cleans it up, so there's one trusted view of demand. Mosaic AI forecasts every store and product against the festival, not last year's calendar. Lakebase puts each order in front of the right manager, and only the ones that need judgement. Genie answers questions on the same governed data. And every decision comes back to Gold, so you can see where managers trust the forecast and where they override it.
- **SHOW (technical altitude, if the CIO leans in):** Lakeflow Connect pulls CDC from the POS and ERP databases; master data and the holiday calendar arrive as files that Auto Loader picks up incrementally. Declarative pipelines build Bronze, Silver and Gold, with expectations that quarantine bad records. The model is tracked in MLflow and registered in Unity Catalog, and a new version replaces the live one only if it passes a gate. One weekly Lakeflow job runs the cycle end to end.
- **TELL:** "No export to a second vendor and back. [CIO], the store and region scope is a real Unity Catalog row filter and the cost mask is a real column mask; I'll show you both live."
- **If asked "is this what the prototype runs?":** "The prototype runs every stage on this diagram. Its sources are synthetic file drops, so ingestion uses Auto Loader; Lakeflow Connect is how we'd connect to your live POS and ERP databases. It lands in the same Bronze tables, so nothing downstream changes."

---

## Slide 6 · Outcome 1 (unify and predict): right quantity, right week

1. **Aligned to the festival:** the forecast compares this year with last year's festival weeks, not last year's calendar weeks.
2. **A buffer sized to the risk:** every order carries a buffer sized to the risk, so safety stock grows into the peak.
3. **Fewer empty shelves:** stock lands in the lead-up weeks, when customers actually buy.

**Chart: one store and gift box, 2026.** Last year's calendar puts the volume in the festival week and the week after; the new forecast moves it into the two lead-up weeks. Mid-Autumn 2026 falls on Sep 25.

**Speaker notes**
- **TELL:** "The first outcome: the right quantity in the right week."
- **SHOW:** The same store and box. Last year's calendar would put the big orders in the festival week and the week after, when demand has already passed. The forecast moves the volume into the lead-up weeks, and adds a buffer where the risk is.
- **TELL:** "Your shelves are full when customers arrive, not a week after."

---

## Slide 7 · Outcome 2 (decide): managers review only the exceptions

Two crops from the Databricks App:
1. **Only the exceptions need you.** About one line in seven is flagged; routine lines follow the forecast and are accepted in one step.
2. **Why this line needs you:** each flagged line says why, for example a peak gift at risk or an order big enough to check.
3. **Why this quantity:** reasons in plain words, such as an upcoming festival or low stock cover, so managers can trust or override it.

**Speaker notes**
- **TELL:** "The second outcome: your managers spend their time only where it matters. I'll switch to the live app now."
- **SHOW:** Follow the run-of-show below (beats 1–5).
- **TELL:** "A human looks at the lines that need judgement, with the reason in plain words. The rest go through in one step, and every decision is recorded."

---

## Slide 8 · Outcome 3 (ask, governed): ask anything, see only your stores

**Ask Genie:** "Which highway stores face the highest Mid-Autumn stockout risk?" Genie lists the highway kiosks most at risk, ranked by sales at stake. It runs as you, on governed gold tables, with the SQL shown.

**Viewing as: same table, different access**

| Persona | Sees | Unit cost |
|---|---|---|
| Head-office analyst | All stores | Visible |
| Regional planner, North | North region only | Visible |
| Store manager, Zhongshan Shop | Own store only | Masked |

**One set of permissions, enforced everywhere:** in the app, in SQL and in Genie, defined once in Unity Catalog as a row filter and a column mask.

**For the CIO:** lineage from every order back to its source system · bad records quarantined before they reach the forecast · every manager decision audited.

**Speaker notes**
- **TELL:** "The third outcome: anyone can ask a question, and everyone sees only what they should."
- **SHOW:** Genie answers a planner's question in plain language and shows its SQL. Then "Viewing as": head office sees every store, the North planner sees the North region, and the Zhongshan store manager sees one store, with unit cost hidden.
- **TELL:** "One governance model in Unity Catalog for your data, not six permission systems to keep in sync."

---

## Slide 9 · What changes for you: how your Monday changes

| Today | With Databricks |
|---|---|
| Order by gut feel and last year's calendar week | Order for the festival week, with a buffer sized to the risk |
| Peak gifts run out before the festival | Volume lands in the lead-up weeks, when customers buy |
| Every line approved by hand | Review the ~15% of lines that need you; accept the routine rest in one step |
| POS, ERP, catalog, store, and holiday data apart, with no single view | One governed view in Unity Catalog; ask Genie, and decisions flow back to gold |

**Suggested next step: plan your next order week together.** Connect your POS and ERP, review the first order week with your planners, and see your own peak-gift exposure before the next Lunar New Year.

**Speaker notes**
- **TELL:** "Here's what your Monday looks like with this in place."
- **SHOW:** Four rows: order for the festival week instead of last year's calendar, stock the lead-up instead of running out, review only the exceptions instead of every line, and one governed view of your five sources instead of separate systems.
- **TELL:** "The next step is simple. We connect your POS and ERP and sit with your planners on the first order week, so you see your own exposure before the next Lunar New Year."

---

## Live demo run-of-show (about 8 minutes)

Each beat is TELL (what you're about to show) → SHOW (the click) → LAND (what it means for the business). Read live values off the screen and keep the talk at outcome level; build-level figures are in `evidence/EVIDENCE.txt` if the CIO asks.

| # | TELL | SHOW | LAND (business meaning) |
|---|---|---|---|
| 1 | "This is the one screen your managers open on Monday." | Header (order week, when data was loaded) and the KPI tiles: peak lines needing an order and peak sales at risk. | You see the exposure in dollars before anyone orders. |
| 2 | "Only some lines need a person." | Needs review: the short list of lines that need a person; the routine bar below it. Point to Accept all routine and **don't press it**. | Your managers' time goes to the ~15% that need judgement. |
| 3 | "Let's go to one region and one store." | Region = North, then Zhongshan Shop. | Each manager works their own queue. |
| 4 | "Here's the mooncake box from the slides." | Open Classic Lotus Mooncake Box. Point to the forecast peaking in the lead-up weeks, where last year's calendar orders for the festival week and after. | The order lands before customers arrive, not after. |
| 5 | "Here's why a manager can trust it." | The plain-words reason (festival in 3 weeks, stock covers too little) and "Why this line needs you" (peak sales at risk, high value). Then Accept, or adjust with a required reason. | The forecast explains itself in plain words, which drives adoption. Every decision is audited and flows back to gold. |
| 6 | "Planners can just ask." | Ask Genie: "Which highway stores face the highest Mid-Autumn stockout risk?" Read the top stores off the answer, then open the SQL. | Self-serve answers on governed data, running as the user, with no ticket. |
| 7 | "Now, who sees what." | Viewing as → Store Manager · Zhongshan Shop: only that store's lines, unit cost masked. Open "How UC enforces this": the app and the Unity Catalog row filter return the same rows, with the live filter and mask definitions. Switch to Regional Planner · North. | One governance model: each person sees only their stores, cost stays private, and the app and Unity Catalog agree. |
| 8 | "Back to your outcomes." | Return to Viewing as → Me and the KPI tiles. | More peak-gift sales, managers on exceptions only, and one platform your CIO can govern. |

**Optional CIO beat (only if asked):**
- *TELL:* "Where does this number come from?"
- *SHOW:* Catalog Explorer lineage from `gold.replenishment_recommendations_current` back through `gold.weekly_demand_features` to the silver POS and inventory tables . Then the row filter `governance.rf_store_scope` and mask `governance.mask_unit_cost` on the table.
- *LAND:* every recommended order traces back to its source rows, under one set of controls.

**CIO aside (beats 5 and 7):**
- The app verifies each user's OAuth token. Spoofed forwarded identity headers are ignored and the verified identity is used; a request with no verifiable identity gets 401.
- Out-of-scope decisions get 403. A persona can only narrow your own access, never widen it, and the auditor persona is read-only.
- A stale edit returns 409 "Someone else changed this order".

## Demo-prep checklist

- [x] **Test decisions cleared** (2026-10-23, backed up first): Lakebase and gold hold 0 decisions and 0 events. The adoption tile shows "not enough decisions yet (0 of 20 needed)" until real decisions exist.
- [x] **Hero line reason checked:** "Mid-Autumn in 3 weeks – forecast 15.9× recent sales | Stock covers 0.2 of the 3 weeks needed | Holiday timing adds 5 units" (live on 24 Oct 2026).
- [ ] **Don't press "Accept all routine" in the demo.** It would write 1,330 decisions. Point to it and use single-line Accept or Adjust instead.
- [ ] **Pre-warm Genie.** Ask the highway question once beforehand; an answer took about 23s in testing.
- [ ] **Add the evaluators as analysts** in `REPLENISHMENT_ANALYSTS` (app.yaml) before the session. Anyone unmapped sees "You don't have any stores assigned yet".
- [ ] **Know what "Viewing as" is:** a narrowing demo. It picks a persona from the UC mapping and intersects it with your own scope. It doesn't sign you in as that person.
- [ ] **Use a demo identity for accept/adjust in beat 5,** and clear those decisions afterwards.
- [ ] **If someone asks about forecast accuracy:** "It beats last year's method in every channel and both holiday seasons. I'm happy to walk your team through the backtest in a technical session."

---

## Reading the room: Q&A sheet

Give the exec answer first. Add the technical answer if the CIO asks, or if the VP wants proof.

### VP Merchandising

**1. What does it cost?**
- *Exec:* We'll size it with you; this build doesn't include a cost figure. The intended benefit is less integration effort: one platform to govern and operate instead of six tools wired together. We haven't measured that saving.
- *Technical:* The pipeline, SQL warehouse, and Lakebase run serverless or autoscaling. The weekly scoring job ran in about six minutes.

**2. What's the risk?**
- *Exec:* Your managers stay in control. Exceptions get a human decision with a reason, routine lines can still be reviewed, and every change is audited.
- *Technical:* The audit trail is append-only. "Accept all routine" is all-or-nothing: if the routine set changed since the user saw it, nothing is saved. Scope fails closed for unmapped users. A new model is compared with the live @champion before promotion.

**3. How fast do you see value?**
- *Exec:* The full loop already runs weekly on this data. Your next step is to drop your own feeds and review a first order week together.
- *Technical:* One weekly job covers refresh, scoring, recommendations, the Lakebase load, and decision ingest, and every task succeeded on the last run.

**4. Will managers actually use it?**
- *Exec:* That's the point of the exception queue: only ~15% of lines ask for a decision, each with its reason in plain words, and approval is one click. We'll measure the share of orders placed from the forecast once your managers use it.
- *Technical:* There are 0 real decisions so far; the app shows "not enough decisions yet" until 20 exist, then the share.

**5. What's the return?**
- *Exec:* The opportunity is $2–3M a year: 20–30% of the $10.3M lost on peak gifts. That's an expected outcome on synthetic data, not a realised return, and it's what you'd track on your own data.
- *Technical:* The holiday backtest lowered modelled lost sales in all 6 season × channel windows. See the backup section for why we don't headline the backtest dollars.

**6. What happens to waste?**
- *Exec:* It stays roughly flat. In the backtest, forecast-driven ordering had slightly less waste than manual ordering, about $42k a year (~1% of today's $3.87M), but the result is mixed by season, so we're not claiming a waste saving. Making the order rule waste-aware is the natural next improvement.
- *Technical:* Mid-Autumn 2025 airport and downtown improved, and Lunar New Year 2026 worsened.

### CIO

**1. What's the architecture?**
- *Exec:* One Databricks platform: Unify, Predict, Decide, Ask, with Unity Catalog governing the data and lineage, and decisions looping back to gold.
- *Technical:*
  - **Unify:** serverless Lakeflow pipeline with 5 bronze Auto Loader streaming tables, plus 6 silver and 2 gold materialized views.
  - **Predict:** LightGBM mean plus quantile(0.9) models on 29 features, registered in UC with @champion.
  - **Decide:** Lakebase Postgres 17 for recommendations and decisions. The app routes lines by five exception rules.
  - **Ask:** an AppKit app and a Genie space on 8 governed tables.
  - Genie is the only GenAI component. We don't use or claim ai_query or other AI functions here.

**2. How do you handle data quality?**
- *Exec:* Bad rows are caught and quarantined automatically, and gold reconciles to source exactly.
- *Technical:* Expectations quarantined exactly the 40 planted defects: 20 unknown-store rows and 20 negative-unit rows. Duplicates collapse to one row. Gold reconciles to source with 0 mismatched weeks in all three channels.

**3. Security and governance?**
- *Exec:* Unity Catalog governs the data, lineage, and access. A row filter limits each persona to its stores or region, a column mask hides unit cost, and the app applies the same mapping to what it reads from Lakebase.
- *Technical:*
  - *Built:*
    - `governance.rf_store_scope` row filter on `(region, location_id)` and `governance.mask_unit_cost` column mask, both on `gold.replenishment_recommendations_current`, driven by `governance.persona_access`.
    - Verified per persona: 2,247 / 782 / 31 rows; unit cost masked for the store manager.
    - Least-privilege grants for the app service principal and 577 lineage rows.
  - *What enforces what:* UC enforces warehouse and Genie reads of the gold table at query time. The app enforces its Lakebase copy using the same UC mapping, server-side.
  - *Demo scope:* each persona maps to an account group in `governance.persona_access`. This is a single-user demo workspace, so I show the personas with "Viewing as" instead of separate accounts. In production, your IdP groups sync to those account groups and the same filter applies unchanged.

**4. How does it integrate with our POS and ERP?**
- *Exec:* Your systems keep running. They drop files, and Lakeflow picks up only what's new.
- *Technical:* Two drops added exactly +12,079 POS and +15,729 inventory rows. The store master bridges POS `store_code` to ERP `location_id`. Direct connectors are an option to scope with you; this build doesn't show them.

**5. Will it scale?**
- *Exec:* It already forecasts every store and SKU, every week.
- *Technical:* 2,247 store-SKU series, 1,860,102 training rows, and 13,482 forecast rows per weekly run. Training took about 25 minutes and scoring about 6.

**6. How do you handle model drift and MLOps?**
- *Exec:* Every model is registered and versioned, compared with the live model before promotion, and checked against its features on every run.
- *Technical:*
  - The scoring job asserts a feature-schema hash before it writes forecasts.
  - By default the gate blocks a worse model: a candidate is promoted only if it scores no worse than the live @champion. Version 6 was promoted through an explicit override, because the corrected festival features changed the feature schema. On its own inputs the previous model (v5) scored about the same, so v6 is not an accuracy win over v5.
  - Known gaps:
    - stockout weeks are excluded rather than demand-corrected
    - some festival-week peaks are still dampened
    - live drift monitoring is next

### Backup (quote only if asked)

- **p90 plan-for coverage:** 91–92% of observed store-SKU-weeks landed within the calibrated p90 across both holiday backtests, and 90–95% on peak gifts.
- **Backtest dollars (caveat first):** across 25 holiday weeks, the forecast policy had $12.9M less modelled lost sales than the manual policy. Scaled up from peak weeks only, that is $26.8M/yr. It is peak weeks scaled up, not a whole-year estimate, and we don't quote it as a forecast of savings or as support for the $2–3M opportunity. A full-year replay comes first.

### Objection handling

- **"We already have a BI tool and a data warehouse."** Keep them. This isn't a BI replacement; it's the forecast-to-order loop BI can't close. Gold tables are open to your BI through a SQL warehouse, and you avoid adding vendor-to-vendor copies for ML, an OLTP database, and an app host.
- **"Why not buy a point forecasting SaaS?"** A SaaS forecast is another copy of your data, another permission model, and a black box your managers won't trust. Here the festival logic is yours, every order traces back to its source rows, access is governed in Unity Catalog, and manager decisions flow back to improve the next forecast.
- **"These numbers are synthetic."** Yes. The synthetic business is calibrated to realistic magnitudes: $160.8M net sales, $17.8M lost sales, and $3.87M waste a year. That's why the next step is your own feeds: so every figure becomes yours.
- **"Your backtest shows much bigger numbers. Why only $2–3M?"** The backtest figure comes from the two most stressed holiday windows, scaled up. We don't treat it as a whole-year number. $2–3M is the opportunity we'd track with you, against the $10.3M lost on peak gifts today.
