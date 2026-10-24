# Eastwind Gourmet · Forecast-driven replenishment

Business deck, text export. This file holds:
- the demo-setup opener
- the nine slides with TELL / SHOW / TELL notes
- the 8-beat live demo run-of-show and a demo-prep checklist
- the reading-the-room Q&A sheet, with a backup section

The visual version is `index.html` and `eastwind-deck.pdf`. The architecture diagram also stands alone as `docs/architecture.html`.

**Sources:** every figure comes from `evidence/EVIDENCE.txt` (cited as E + line number). The governance and exception-queue figures come from the version of that file on branch `polly/app-viewer-rbac`, sections 9 and 9b; lines 1–393 are the same as on main. All data is synthetic (seed 42). Accuracy is described in words only; this deck quotes no forecast-error percentages.

**In the room**
- **VP Merchandising** (executive sponsor): owns lost sales, waste, and margin. Stay at outcome altitude: dollars, shelves, and manager time.
- **CIO** (domain owner): must unify fragmented data and put an explainable forecast into ordering. Go one level deeper on request: pipeline, governance, MLOps, security.

**Storyline: from a Monday guess to a Monday order.** You get three outcomes on one platform:
1. **Right quantity, right week.** Lakeflow unifies your five feeds, and Mosaic AI forecasts against the festival, not the calendar week.
2. **Managers review only the exceptions.** The Databricks App on Lakebase routes the ~15% of lines that need judgement and lets the routine rest go through in one step, with every decision audited.
3. **Ask anything, see only your stores.** Genie answers in plain language on governed data. Unity Catalog policies define what each person can see, and the app applies the same mapping to its Lakebase reads.

Manager decisions flow back to gold, so next week's forecast learns from them. One platform is the reason that loop closes.

---

## Demo setup opener (30–45 seconds)

> "Today Eastwind orders festival gifts for the week the festival fell last year. So shelves run empty before Mid-Autumn and fill up after it.
>
> Across your 80 stores that costs about $17.8M a year in lost sales, and $10.3M of it is on peak gifts. In Mid-Autumn 2025, about one in five peak-gift store-days was out of stock.
>
> In the next 20 minutes I'll show you three things. First, what you get: $2–3M a year of peak-gift sales to win back, with your managers looking only at the ~15% of lines that need them. Then one store, one mooncake box and one festival, from forecast to an order the manager approves in one click. Finally, how it runs on one Databricks platform, governed in Unity Catalog, so each person sees only their own stores.
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

## Slide 2 · Your outcome: what you get

| Tile | Value | What it means | Note |
|---|---|---|---|
| Peak-gift sales to win back | **$2–3M/yr** | The opportunity in fuller festival shelves | Expected: 20–30% of the $10.3M/yr you lose on peak gifts today |
| Manager time | **~15%** | of order lines need a manager. The rest are routine | 231 of 1,561 lines this order week need a decision |
| Seen before the week starts | **$3.6M** | of peak-gift sales flagged as at risk | 481 of 908 peak-gift lines need an order this week |

- **VP Merchandising:** full shelves in the festival lead-up, and your managers spend time only where it matters.
- **CIO:** one platform from POS files to approved order, governed in Unity Catalog, with no vendor-to-vendor copies.

**Speaker notes**
- **TELL:** "Three numbers, in your terms."
- **SHOW:** The opportunity is $2–3M a year: winning back 20–30% of the $10.3M you lose on peak gifts. Your managers' time goes where it matters, because only 231 of this week's 1,561 lines, about 15%, need a decision. And you see the exposure before the week starts: $3.6M of peak-gift sales flagged across 481 of 908 peak lines.
- **TELL:** "More festival sales, less manager effort, and no surprises on Monday."

---

## Slide 3 · The problem: festivals move, orders don't

- **$17.8M/yr** lost sales from empty shelves across your 80 stores
- **$10.3M/yr** of that on peak gifts, 57.5% of all lost sales
- **18.7–21.1%** of peak-gift store-days out of stock in Mid-Autumn 2025, vs 8.6% overall

**Chart: Zhongshan Shop · Classic Lotus Mooncake Box · Mid-Autumn 2025.** Stocked for 2024's peak, out of stock for 2025's.

| Week of (2025) | Same week last year (what gets ordered) | Sold in 2025 | Days out of stock |
|---|---|---|---|
| Sep 8 | 312 | 14 | 0 |
| Sep 22 | 6 | 353 | 0 |
| Sep 29 | 17 | 72 | 6 |
| Oct 6 (festival week) | 11 | 0 | 7 |

Mid-Autumn fell on Sep 17 in 2024 and Oct 6 in 2025. Ordering by last year's calendar week stocked this line for the wrong week.

**Speaker notes**
- **TELL:** "Here's where your money leaks, and why."
- **SHOW:** $17.8M a year in lost sales, $10.3M of it on peak gifts. Then one store-SKU line: in 2025 the shelf was stocked to 2024's peak week. Customers came two weeks later, and the line was out of stock 6 and 7 days in its two peak weeks.
- **TELL:** "That isn't a bad manager. It's the calendar. The festival moved and the order didn't."

---

## Slide 4 · Why it's hard today: three things in the way

1. **Fragmented feeds:** POS, ERP inventory, product catalog, store master, holiday calendar. Each has its own owner, format, and refresh cycle. Even your store IDs differ: `DT001` vs `L0001`. *With Databricks:* Lakeflow reconciles all five into one governed gold table.
2. **Stockouts hide demand.** When the shelf is empty, sales stop, so your history records what sold, not what customers wanted. *With Databricks:* the forecast learns from weeks with stock on the shelf.
3. **The usual fix: six tools.** ETL tool, warehouse, ML platform, OLTP database, BI/chat, app hosting. Each hop adds a copy, a handoff, and another set of permissions to keep in sync. *With Databricks:* one platform and one governed data flow.

**Speaker notes**
- **TELL:** "Three reasons this is harder than it looks."
- **SHOW:** The feeds don't share keys. History undercounts demand exactly when shelves are empty. And the usual answer is a chain of six tools, each with its own copy of the data and its own permissions.
- **TELL:** "Databricks fixes the first two in the data and the model. The third is a platform choice, and it's what lets the loop close."

---

## Slide 5 · How it works: one platform, end to end

Your systems keep running; they just drop files. The five feeds (POS sales, ERP inventory, product catalog, store master, holiday calendar) go into one **Databricks Data Intelligence Platform** (one governed data flow):

| Step | Product | What it does | Proof label |
|---|---|---|---|
| **Unify** | Lakeflow | Bronze, silver, gold; quality expectations | 0 mismatched weeks |
| **Predict** | Mosaic AI · MLflow | Forecast + p90 band; registered, versioned, and compared with the live model before promotion | Festival-aligned |
| **Decide** | Lakebase + App | Exception-based queue; every decision audited | ~15% need you |
| **Ask** | Genie | Natural language; runs as the user, SQL shown | No ticket needed |

- **Loop:** manager decisions flow back to gold, so next week's forecast learns. This is the most prominent element on the slide.
- **Unity Catalog governs every step:** lineage and permissions, plus a **row filter** (store and region scope) and a **column mask** (unit cost) on the gold recommendations table. The app applies the same Unity Catalog mapping to its Lakebase reads.
- **Who uses it:** store manager (own store's exceptions), regional planner (one region), head-office analyst (all stores, with Genie), executive (outcome KPIs).

**Speaker notes**
- **TELL:** "One platform, four steps, and a loop."
- **SHOW:** Your systems just drop files. Lakeflow unifies them, and gold matches source with zero mismatched weeks. Mosaic AI forecasts each store and SKU against the festival, tracked in MLflow, and each new model is registered, versioned, and compared with the live model before it is promoted. Lakebase and the app put each line in front of the right manager, but only the ~15% that need judgement. Genie answers on the same governed tables. Then the red arrow: decisions flow back to gold for the next run. Unity Catalog sits underneath all of it.
- **TELL:** "No export to a second vendor and back. [CIO], the store and region scope is a real Unity Catalog row filter and the cost mask is a real column mask; I'll show you both live."

---

## Slide 6 · Outcome 1 (unify and predict): right quantity, right week

1. **Aligned to the festival:** the forecast compares this year with last year's festival weeks, not last year's calendar weeks.
2. **A buffer sized to the risk:** every line carries a p90 plan-for quantity, so safety stock grows into the peak.
3. **Fewer empty shelves:** in the holiday backtest, modelled lost sales fell in all 6 season and channel windows.

**Chart: Zhongshan Shop · Classic Lotus Mooncake Box · 2026.** Volume moves into the lead-up weeks.

| Week of (2026) | Same week last year | New forecast (units) |
|---|---|---|
| Sep 7 | 14 | 188 |
| Sep 14 | 85 | 416 |
| Sep 21 (festival week) | 353 | 241 |
| Sep 28 | 504 | 10 |

The forecast units are from the latest weekly run. Mid-Autumn 2026 is Sep 25.

**Speaker notes**
- **TELL:** "The first outcome: the right quantity in the right week."
- **SHOW:** The same store and box. Last year's calendar would order 353 and 504 for the festival week and the week after, when demand has already passed. The forecast puts the volume in the two lead-up weeks: 188, then 416. The p90 plan-for adds buffer where the risk is. And when we replayed two holiday seasons, modelled lost sales fell in every season and channel.
- **TELL:** "Your shelves are full when customers arrive, not a week after."

---

## Slide 7 · Outcome 2 (decide): managers review only the exceptions

Two crops from the live Databricks App, captured read-only on 24 Oct 2026:
1. **231 of 1,561 lines need you.** The 1,330 routine lines follow the forecast and can be accepted in one step (the queue header with "Accept all routine").
2. **Why this line needs you:** peak gift at risk, $22.5K of sales if not ordered; high value, $12.1K at cost (the Zhongshan Shop × Classic Lotus Mooncake Box line sheet).
3. **Why this quantity:** Mid-Autumn in 3 weeks, forecast 15.9x recent sales. Model v6.

**Speaker notes**
- **TELL:** "The second outcome: your managers spend their time only where it matters. I'll switch to the live app now."
- **SHOW:** Follow the run-of-show below (beats 1–5).
- **TELL:** "About 15% of lines get a human look, with the reason in plain words. The rest go through in one step. The Accept / Adjust / Reject buttons sit below this view, and I'll use them live."

---

## Slide 8 · Outcome 3 (ask, governed): ask anything, see only your stores

**Ask Genie:** "Which highway stores face the highest Mid-Autumn stockout risk?" The answer is Taian Service Area N: 6 SKUs, $56,791 at risk. Genie runs as you, on governed gold tables, with the SQL shown.

**Viewing as: same table, different access**

| Persona | Store-SKUs visible | Unit cost |
|---|---|---|
| Head-office analyst | 2,247 | Visible |
| Regional planner, North | 782 | Visible |
| Store manager, Zhongshan Shop | 31 | Masked |

The inset shows the live "Viewing as Store Manager · Zhongshan Shop L0001" strip and the governance drawer, where both the app (Lakebase) and the Unity Catalog row filter count 31 of 2,247 rows. The row filter and column mask sit on the gold recommendations table; the app applies the same mapping to its Lakebase reads.

**For the CIO:** 0 mismatched weeks, gold vs source · 40 of 40 planted bad records quarantined · spoofed identity ignored; out-of-scope decisions refused.

**Speaker notes**
- **TELL:** "The third outcome: anyone can ask a question, and everyone sees only what they should."
- **SHOW:** Genie answers a planner's question in plain language and shows its SQL. Then "Viewing as": the same gold table returns 2,247 store-SKUs to head office, 782 to the North planner, and 31 to the Zhongshan store manager, with unit cost masked. The governance drawer proves the app and Unity Catalog agree.
- **TELL:** "One governance model in Unity Catalog for your data, not six permission systems to keep in sync."

---

## Slide 9 · What changes for you: how your Monday changes

| Today | With Databricks |
|---|---|
| Order by gut feel and last year's calendar week | Order for the festival week, with a p90 buffer sized to the risk |
| Peak gifts run out before the festival | Volume lands in the lead-up weeks, when customers buy |
| Every line approved by hand | Review the ~15% of lines that need you; accept the routine rest in one step |
| POS, ERP, catalog, store, and holiday data apart, with no single view | One governed view in Unity Catalog; ask Genie, and decisions flow back to gold |

**Suggested next step: plan your next order week together.** Your POS and ERP teams drop the five feeds, your planners review the first queue with us, and you see your own peak-gift exposure before the next Lunar New Year.

**Speaker notes**
- **TELL:** "Here's what your Monday looks like with this in place."
- **SHOW:** Four rows: order for the festival week instead of last year's calendar, stock the lead-up instead of running out, review only the exceptions instead of every line, and one governed view of your five sources instead of separate systems.
- **TELL:** "The next step is simple. Your teams drop the feeds and we sit with your planners on the first order week, so you see your own exposure before the next Lunar New Year."

---

## Live demo run-of-show (about 8 minutes)

Each beat is TELL (what you're about to show) → SHOW (the click) → LAND (what it means for the business). Read live values off the screen; the figures here are from the latest evidence run (`evidence/EVIDENCE.txt`, refreshed 24 Oct 2026; see its §1b live snapshot).

| # | TELL | SHOW | LAND (business meaning) |
|---|---|---|---|
| 1 | "This is the one screen your managers open on Monday." | Header (order week, data loaded, model v6) and the KPI tiles: 481 of 908 peak lines need an order, $3.60M of peak sales at risk. | You see the exposure in dollars before anyone orders. |
| 2 | "Only some lines need a person." | Needs review: "231 of 1,561 lines need you"; routine bar "1,330 routine lines · $1.72M at cost". Point to Accept all routine and **don't press it**. | Your managers' time goes to the ~15% that need judgement. |
| 3 | "Let's go to one region and one store." | Region = North (82 need review, 462 routine), then Zhongshan Shop. | Each manager works their own queue. |
| 4 | "Here's the mooncake box from the slides." | Open Classic Lotus Mooncake Box. Point to the forecast peaking in the lead-up weeks (188, 416), where last year's calendar orders 353 and 504 for the festival week and after. | The order lands before customers arrive, not after. |
| 5 | "Here's why a manager can trust it." | The reason ("Mid-Autumn in 3 weeks – forecast 15.9x recent sales · Stock covers 0.2 of the 3 weeks needed · Holiday timing adds 5 units") and "Why this line needs you" ($22.5K peak sales at risk; $12.1K at cost). Then Accept, or adjust with a required reason. | The forecast explains itself in plain words, which drives adoption. Every decision is audited and flows back to gold. |
| 6 | "Planners can just ask." | Ask Genie: "Which highway stores face the highest Mid-Autumn stockout risk?" The top answer in testing was Taian Service Area N, 6 SKUs, $56,791. Open the SQL. | Self-serve answers on governed data, running as the user, with no ticket. |
| 7 | "Now, who sees what." | Viewing as → Store Manager · Zhongshan Shop L0001: "2 of 20 lines need you", unit cost masked. Open "How UC enforces this": app 31 / 2,247 rows, UC row filter 31 / 2,247 rows, and the live row filter and mask definitions. Switch to Regional Planner · North (782 store-SKUs). | One governance model: each person sees only their stores, cost stays private, and the app and Unity Catalog agree. |
| 8 | "Back to your outcomes." | Return to Viewing as → Me and the KPI tiles. | More peak-gift sales, managers on exceptions only, and one platform your CIO can govern. |

**Optional CIO beat (only if asked):**
- *TELL:* "Where does this number come from?"
- *SHOW:* Catalog Explorer lineage from `gold.replenishment_recommendations_current` back through `gold.weekly_demand_features` to the silver POS and inventory tables (577 lineage rows). Then the row filter `governance.rf_store_scope` and mask `governance.mask_unit_cost` on the table.
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
  - *Not yet:* account groups for the four personas aren't created; today's bindings are by principal, and an admin creates the groups and reruns the script. The gold decision-history tables have no row filter.

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
