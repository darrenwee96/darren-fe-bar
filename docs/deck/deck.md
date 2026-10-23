# Eastwind Gourmet · Forecast-driven replenishment

Business deck, text export. It contains:
- the demo-setup opener
- the nine slides with TELL / SHOW / TELL notes
- the 8-minute live demo run-of-show and a demo-prep checklist
- the reading-the-room Q&A sheet with a CIO backup section

The visual version is `index.html` and `eastwind-deck.pdf`. Every figure comes from `evidence/EVIDENCE.txt` (cited as E + line number). All data is synthetic (seed 42). Accuracy is described in words only; this deck quotes no forecast-error percentages.

**In the room**
- **VP Merchandising** (executive sponsor): owns lost sales, waste, and margin. Stay at outcome altitude: dollars, shelves, and manager trust.
- **CIO** (domain owner): must unify fragmented data and put an explainable forecast into ordering. Go one level deeper on request: pipeline, governance, MLOps, security.

**Storyline: from a Monday guess to a Monday order.** Three outcomes:
1. **Right quantity in the right week.** Lakeflow unifies five feeds, and the ML forecast aligns history to the festival, not the calendar week.
2. **An order the manager trusts and approves on one screen.** The Databricks App on Lakebase shows the reason, and every decision is audited.
3. **Answers without raising a ticket.** Genie answers on governed data.

Unity Catalog governs the data and lineage, and manager decisions flow back to gold. One platform is the reason that loop closes.

---

## Demo setup opener (30–45 seconds)

> "Eastwind orders festival gifts for the week the festival fell last year, so shelves run empty before Mid-Autumn and fill up after it.
>
> That's about 80 stores across downtown, highway, and airport, losing $17.8M a year in sales to empty shelves. $10.3M of that is on peak gifts. In Mid-Autumn 2025, about one in five peak-gift store-days was out of stock.
>
> In the next 20 minutes I'll show you three things. The outcome we're targeting: $2–3M a year of those peak-gift sales back, with waste roughly flat, about +$42k a year, ~1% of the $3.87M base, in the backtest. One store, one mooncake box, and one festival, from forecast to an order the manager approves in one click. And how it runs on one Databricks platform, so decisions flow straight back into the data.
>
> [VP name], I'll keep us on outcomes. [CIO name], stop me anywhere and I'll go as deep as you want."

---

## Slide 1 · Forecast-driven replenishment

**Eastwind Gourmet · From a Monday guess to a Monday order**

Eastwind orders festival gifts for the week the festival fell last year, so shelves run empty before Mid-Autumn and fill up after it.

For the VP Merchandising and the CIO · October 2026

**Speaker notes**
- **TELL:** "This is about one decision your managers make every Monday: how much to order."
- **SHOW:** The one-liner. Lunar festivals move every year, and ordering by last year's calendar week misses them.
- **TELL:** "Fix that one decision on peak gifts and you get sales back, with waste roughly flat, about +$42k a year, ~1% of the $3.87M base, in the backtest."

---

## Slide 2 · The outcome: what you get

| Tile | Value | What it means | Note |
|---|---|---|---|
| Lost sales recovered (target) | **$2–3M/yr** | 20–30% of the $10.3M/yr you lose on peak gifts | A target for the pilot to prove, not a result yet |
| Waste guardrail | **+$42k/yr** | Waste roughly flat: ~1% of the $3.87M/yr base, in the backtest | Not a saving. Waste-aware ordering is the day-60 item |
| Flagged this order week | **$3.6M** | of peak-gift sales at risk without an order | 481 of 908 peak-gift lines need an order, order week of Aug 31, 2026 |

- **VP Merchandising:** full shelves in the festival lead-up, with orders your managers approve on one screen.
- **CIO:** one platform from POS files to approved order, so manager decisions flow back into the data.

**Speaker notes**
- **TELL:** "Three numbers, in your terms."
- **SHOW:** The target is $2–3M a year, which means winning back 20–30% of the $10.3M you lose on peak gifts. It's a target, and the pilot is how we prove it. Waste is the guardrail: roughly flat, about +$42k a year, ~1% of the $3.87M base, in the backtest. Waste-aware ordering is the day-60 item. And this week alone, the app flags $3.6M of peak-gift sales at risk, across 481 of 908 peak lines.
- **TELL:** "So, more peak-gift sales with waste roughly flat, and you can see the exposure every Monday."

---

## Slide 3 · The problem: last year’s calendar

- **$17.8M/yr** lost sales from empty shelves across 80 stores
- **$10.3M/yr** of that on peak gifts, 57.5% of all lost sales
- **18.7–21.1%** of peak-gift store-days out of stock in Mid-Autumn 2025, vs 8.6% overall

**Chart: Zhongshan Shop · Classic Lotus Mooncake Box · Mid-Autumn 2025.** Stocked for 2024's peak, out of stock for 2025's.

| Week of (2025) | Same week last year (what gets ordered) | Sold in 2025 | Days out of stock |
|---|---|---|---|
| Sep 8 | 312 | 14 | 0 |
| Sep 22 | 6 | 353 | 0 |
| Sep 29 | 17 | 72 | 6 |
| Oct 6 (festival week) | 11 | 0 | 7 |

Mid-Autumn fell on Sep 17 in 2024 and Oct 6 in 2025. The chart shows the four weeks in the evidence spot check. Waste is a further $3.87M/yr.

**Speaker notes**
- **TELL:** "Here's where the money leaks, and why."
- **SHOW:** $17.8M a year in lost sales, $10.3M of it on peak gifts. Then one store-SKU line: in 2025 the shelf was stocked to 2024's peak week. Customers came two weeks later, and the line was out of stock 6 and 7 days in its two peak weeks.
- **TELL:** "That isn't a bad manager. It's the calendar. The festival moved and the order didn't."

---

## Slide 4 · Why it’s hard (for the CIO)

1. **Fragmented feeds:** POS, ERP inventory, product catalog, store master, holiday calendar. Each has its own owner, format, and refresh cycle. Even store IDs differ: `DT001` vs `L0001`. *How we handle it:* Lakeflow reconciles all five into one governed gold table.
2. **Stockouts hide demand.** When the shelf is empty, sales stop, so history records what sold, not what customers wanted. *How we handle it:* training skips weeks with two or more days out of stock.
3. **The usual fix: six tools.** ETL tool, warehouse, ML platform, OLTP database, BI/chat, app hosting. Each hop adds a copy, a handoff, and another set of permissions to keep in sync. *How we handle it:* one platform, one governed data flow.

**Speaker notes**
- **TELL:** "Three reasons this is harder than it looks."
- **SHOW:** The feeds don't share keys. History undercounts demand exactly when shelves are empty. And the usual answer is a chain of six tools, each with its own copy of the data and its own permissions.
- **TELL:** "We'll fix the first two in the data and the model. The third is a platform choice, and it's what lets the loop close."

---

## Slide 5 · Architecture: one platform, end to end

Your POS and ERP keep running; they just drop files. Five raw feeds go into one **Databricks Data Intelligence Platform** band (one governed data flow):

| Outcome | Step | Product | Proof |
|---|---|---|---|
| Right quantity, right week | **Unify** | Lakeflow: bronze, silver, gold | 0 mismatched weeks |
| Right quantity, right week | **Predict** | ML, MLflow, festival-aligned features | @champion gate |
| An order you trust | **Decide** | Lakebase + Databricks App | Audited; conflicting edits rejected |
| Answers without a ticket | **Ask** | Genie Agent | Runs on governed data |

- **Loop:** manager decisions flow back to gold. This is the most prominent element on the slide.
- **Unity Catalog** governs data and lineage at every step. Store-manager scoping is enforced in the app today. UC row filters and masks are the day-30 governance pack.

**Speaker notes**
- **TELL:** "One platform, four steps, and a loop."
- **SHOW:** Your systems just drop files. Lakeflow unifies them, and gold reconciles to source with zero mismatched weeks. The forecast trains on gold and only serves after the @champion gate. Orders and decisions live in Lakebase behind the app, every change is audited, and conflicting edits are rejected. Genie answers on the same governed tables. Then the red arrow: manager decisions flow back to gold for the next run.
- **TELL:** "One platform is why that loop closes. There's no export to a second vendor and back. [CIO], Unity Catalog governs the data and lineage today. Per-manager scoping lives in the app, and UC row filters are on the day-30 roadmap."

---

## Slide 6 · The demo: what you’ll see

**One store, one mooncake box, one festival**
1. **The order week:** 481 of 908 peak-gift lines need an order, and $3.6M of peak sales are flagged.
2. **One line you can trust:** Zhongshan Shop's Classic Lotus Mooncake Box, with its reason and plan-for range.
3. **Approve, then ask:** accept or adjust with a reason, then ask Genie which highway stores are most at risk.

**Chart: Zhongshan Shop · Classic Lotus Mooncake Box · 2026.** The forecast fixes the calendar mistake.

| Week of (2026) | Same week last year | New forecast (units) |
|---|---|---|
| Sep 7 | 14 | 188 |
| Sep 14 | 85 | 416 |
| Sep 21 (festival week) | 353 | 241 |
| Sep 28 | 504 | 10 |

The forecast units come from the latest weekly run. Mid-Autumn 2026 is Sep 25. These are forecast figures, not outcomes.

**Speaker notes**
- **TELL:** "Here's exactly what I'm about to show you, so you can watch for it."
- **SHOW:** The same store and box as the problem slide. Last year's calendar would order 353 and 504 for the festival week and the week after, when demand has already passed. The forecast puts the volume in the two lead-up weeks instead: 188 and then 416.
- **TELL:** "It fixes the calendar mistake. Whether the shelf stays full is what the pilot measures."

---

## Slide 7 · The app: what managers see

Two crops from the live Databricks App (captured read-only on 2026-10-23), filtered to Region North:
1. **Region North, ranked:** the Order need by store panel. North stores are ranked by sales lost if not ordered, and Zhongshan Shop is in the top ten.
2. **Why this quantity:** the line sheet for Zhongshan Shop × Classic Lotus Mooncake Box, with its holiday-driven reason next to stock, shelf life, and cap.
3. **Plan for the peak:** on the same sheet, the forecast and p90 band peak before the festival, while last year's line peaks after it.

**Speaker notes**
- **TELL:** "This is the manager's Monday. I'll switch to the live app now."
- **SHOW:** Follow the run-of-show below.
- **TELL:** "One screen to see the risk, understand the line, and approve it. The decision buttons sit at the bottom of this sheet, and I'll use them live."

---

## Slide 8 · Impact and proof: proven vs next

| Success measure | Evidence | Status | Next |
|---|---|---|---|
| Forecast accuracy by channel | Beats last year's method in every channel and both holiday seasons | Proven | Track live by channel |
| Stockouts on peak gift SKUs | Modelled lost sales down in 6 of 6 holiday windows (baseline: 18.7–21.1% of peak-gift days out) | Simulated | Measure in the pilot |
| Expired and marked-down value | Roughly flat: +$42k/yr, ~1% of the $3.87M/yr base | Guardrail | Waste-aware ordering |
| Orders placed from forecast | Not measured yet: test decisions only | Not yet | Measure in the pilot |

**Holiday backtest: 6 of 6** holiday windows had lower lost sales, with waste roughly flat (up ~1%). The windows are Mid-Autumn 2025 and Lunar New Year 2026, each in 3 channels. This is a simulation on synthetic data.

**For the CIO:** 0 mismatched weeks, gold vs source · 40 of 40 planted bad records quarantined · spoofed identity ignored; out-of-scope decisions refused.

**Speaker notes**
- **TELL:** "Here's what's proven and what isn't yet. I'd rather you hear the gaps from me."
- **SHOW:** Accuracy is proven: the forecast beats last year's method in every channel and both holiday seasons. On stockouts, the simulation lowered lost sales in all six season-and-channel windows. Waste was roughly flat, about +$42k a year, ~1% of the $3.87M base, in the backtest: a guardrail, not a saving. Adoption isn't measured yet; we only have test decisions. For the CIO: gold matches source exactly, every planted bad record was caught, spoofed identity headers were ignored in favour of the verified sign-in, and out-of-scope decisions were refused.
- **TELL:** "The direction is clear. The pilot turns it into your numbers."

---

## Slide 9 · Roadmap: 30 / 60 / 90 days

- **Day 30, governance pack:** UC row filters by region, cost masks, persona groups, column comments.
- **Day 60, waste-aware ordering:** shelf-life and waste limits in the order rule; replay a full year.
- **Day 90, one-region pilot:** timed to cover the next Lunar New Year peak, with managers ordering from the app.

**The ask: approve a one-region pilot.** You measure:
- peak-gift out-of-stock rate vs the 18.7–21.1% baseline
- share of orders placed from the forecast
- waste vs today's $3.87M/yr base (backtest: +$42k/yr, ~1%)

**Speaker notes**
- **TELL:** "Here's how we get from simulation to proof in your stores."
- **SHOW:** In 30 days, close the governance gaps in Unity Catalog. In 60 days, make ordering waste-aware and replay a full year. By day 90, one region orders from the app, timed to cover the next Lunar New Year peak, your next big gifting season.
- **TELL:** "The ask is one region, with three measures you can read: peak-gift out-of-stock rate against today's 18.7–21.1%, the share of orders placed from the forecast, and waste against today's $3.87M base."

---

## Live demo run-of-show (about 8 minutes)

Each beat is TELL (what you're about to show) → SHOW (the click) → LAND (what it means for the business). Read live values off the screen; the figures here are from the latest evidence run.

| # | TELL | SHOW | LAND (business meaning) |
|---|---|---|---|
| 1 | "This is the screen a manager opens on Monday." | KPI strip, all regions: 481 of 908 peak-gift lines need an order, $3.60M of peak sales at risk (E491). | You see the exposure in dollars before anyone orders. |
| 2 | "Let's go to one region." | Set Region = North. The KPI strip and queue rescope (in the evidence, a North manager sees 782 store-SKUs, E483). | Each manager sees their own stores, and the scope is enforced server-side. |
| 3 | "Now one store." | Click Zhongshan Shop in Order need by store. | Start with the lines that lose the most sales. |
| 4 | "Here's the mooncake box from the slide." | Open the Classic Lotus Mooncake Box line. Point to the forecast peaking in the lead-up weeks (188, 416) where last year's calendar orders 353 and 504 for the festival week and after (E261–264). | The order lands before customers arrive, not after. |
| 5 | "Here's why a manager can trust it." | The reason string (live, 2026-10-23: "+5 units from holiday timing · Mid-Autumn Festival 2026 in 3 weeks · Forecast 15.9x recent weekly sales · Stock covers 0.2 of 3 weeks needed"), the p90 plan-for column, shelf life (30 days), and "Cap applied: None" for this line. | The forecast explains itself in units, which drives adoption. |
| 6 | "The manager stays in control." | Accept, or adjust with a reason (e.g. 672 → 600, "Display space limited during renovation", E384–386). Point out that a reason is required. | Every decision is versioned, audited, and flows back to gold on the next weekly run. |
| 7 | "Planners can just ask." | Ask Genie: "Which highway stores face the highest Mid-Autumn stockout risk?" The tested top answer is Taian Service Area N, 6 SKUs, $56,791 (E432–436). Open the SQL. | Self-serve answers on governed data, running as the user, with the SQL visible. No ticket needed. |
| 8 | "Back to your three measures." | Return to the KPI strip. | Peak-gift out-of-stock rate, share of orders from the forecast, and waste against today's base. That's what the pilot measures. |

**Optional CIO beat (only if asked):**
- *TELL:* "Where does this number come from?"
- *SHOW:* Catalog Explorer lineage from `gold.replenishment_recommendations_current` back through `gold.weekly_demand_features` to the silver POS and inventory tables (577 lineage rows, E160–168).
- *LAND:* every recommended order traces back to its source rows.

**CIO aside (beats 2 and 6):**
- The app verifies each user's OAuth token. Spoofed forwarded identity headers are ignored and the verified identity is used; a request with no verifiable identity gets 401 (E474–478).
- An out-of-region decision returns 403, and an unmapped user sees nothing (E379–382, E480–484).
- A stale edit returns 409 "Someone else changed this order" (E370–372).

## Demo-prep checklist

- [x] **The MC01 reason shows real drivers** (checked read-only against the live app and gold on 2026-10-23): "+5 units from holiday timing · Mid-Autumn Festival 2026 in 3 weeks · Forecast 15.9x recent weekly sales · Stock covers 0.2 of 3 weeks needed". Lead with "Mid-Autumn Festival 2026 in 3 weeks" and "Forecast 15.9x recent weekly sales". "+5 units from holiday timing" reads small next to them, so have an answer ready if it's asked about. No shelf-life cap applies to this line.
- [ ] **Clear the 3 test decisions** (L0008, L0022, L0026) from Lakebase and gold, so the adoption tile and the Genie override answers start empty (E394–395, E574–575).
- [ ] **Pre-warm Genie.** Ask the highway question once beforehand; a cold answer took about 23s in testing (E441–443).
- [ ] **Add scope entries for the evaluators.** Anyone not in `replenishment.user_scope` sees "No planning scope assigned" and an empty queue (E480–484, E499).
- [ ] **Have an answer ready if someone asks about the on-screen accuracy tile.** "It's the backtest accuracy against last year's method. In this conversation we keep it simple: it beats last year's method in every channel and both holiday seasons. I'm happy to walk the CIO's team through the backtest in a technical session."
- [ ] **Use a demo identity for accept/adjust in beat 6,** and clear those decisions afterwards.

---

## Reading the room: Q&A sheet

Give the exec answer first. Add the technical answer if the CIO asks, or if the VP wants proof.

### VP Merchandising

**1. What does it cost?**
- *Exec:* We'll size the pilot with you; this build doesn't include a cost figure. The intended benefit is less integration effort: one platform to govern and operate instead of six tools wired together. We haven't measured that saving.
- *Technical:* The pipeline, SQL warehouse, and Lakebase run serverless or autoscaling (E87–88, E354). The weekly scoring job ran in about six minutes (E248).

**2. What's the risk?**
- *Exec:* Managers stay in control: every line can be accepted, adjusted, or rejected with a reason, and every change is audited. We start with one region.
- *Technical:* The audit trail is append-only (E383–386). Scope blocks access by default, and unmapped users see nothing (E379–382, E480–484). The model only serves after the @champion gate (E201–203).

**3. How fast do we see value?**
- *Exec:* The full loop already runs weekly. The plan has one region ordering from it by day 90, timed to cover the next Lunar New Year peak.
- *Technical:* One weekly job covers refresh, scoring, recommendations, the Lakebase load, and decision ingest, and every task succeeded on the last run (E247–251).

**4. Will managers actually use it?**
- *Exec:* That's why every line explains itself and approval is one click. To be honest, we haven't measured adoption yet; we only have test decisions. The pilot measures the share of orders placed from the forecast.
- *Technical:* The decisions in the system are 3 test entries written during app verification. They aren't an adoption result, and they'll be cleared before the demo (E389–395).

**5. What's the ROI?**
- *Exec:* The target is $2–3M a year, 20–30% of the $10.3M lost on peak gifts. It's a target on synthetic data, not a realised return; the pilot measures the real figure.
- *Technical:* The holiday backtest lowered modelled lost sales in all 6 season × channel windows (E314–321, E337). See the CIO backup below for why we don't headline the backtest dollars.

**6. What happens to waste?**
- *Exec:* It stays roughly flat, about +$42k a year, ~1% of the $3.87M base, in the backtest. That's the guardrail, not a saving. Waste-aware ordering is the day-60 item.
- *Technical:* +$42k/yr on the $3.87M/yr base. Mid-Autumn 2025 airport and downtown improved, and Lunar New Year 2026 worsened (E329, E341–344).

### CIO

**1. What's the architecture?**
- *Exec:* One Databricks platform: Unify, Predict, Decide, Ask, with Unity Catalog governing the data and lineage, and decisions looping back to gold.
- *Technical:*
  - Serverless Lakeflow pipeline: 5 bronze Auto Loader streaming tables, 6 silver and 2 gold materialized views (E87–89).
  - LightGBM mean plus quantile(0.9) models on 29 features, registered in UC with @champion (E184–186).
  - Lakebase Postgres 17 for recommendations and decisions (E354).
  - An AppKit app and a Genie space on 8 governed tables (E405–407, E450).
  - The only GenAI component is Genie. We don't use or claim ai_query or other AI functions here.

**2. How do you handle data quality?**
- *Exec:* Bad rows are caught and quarantined automatically, and gold reconciles to source exactly.
- *Technical:* Expectations quarantined exactly the 40 planted defects: 20 unknown-store rows and 20 negative-unit rows. Duplicates collapse to one row. Gold reconciles to source with 0 mismatched weeks in all three channels (E112–122).

**3. Security and governance?**
- *Exec:* Unity Catalog governs the data and its lineage today. Per-manager scoping is enforced in the app. UC row filters, masks, and persona groups are the day-30 governance pack.
- *Technical:*
  - *Built:* least-privilege grants for the app service principal and 577 lineage rows (E155–168). The app verifies each user's OAuth token: spoofed forwarded identity headers are ignored and the verified identity is used, and a request with no verifiable identity gets 401. Out-of-scope decisions get 403. Server-side scope blocks access by default (E474–484). Genie runs as the user (E441–442).
  - *Not built yet:* row filters, column masks (unit cost is visible to gold readers), persona groups, and UC column comments (E170–176).

**4. How does it integrate with our POS and ERP?**
- *Exec:* Your systems keep running. They drop files, and Lakeflow picks up only what's new.
- *Technical:* Two drops added exactly +12,079 POS and +15,729 inventory rows (E98–101). The store master bridges POS `store_code` to ERP `location_id` (E79–80). Direct connectors are an option to scope in the pilot; this build doesn't show them.

**5. Will it scale?**
- *Exec:* It already forecasts every store and SKU every week.
- *Technical:* 2,247 store-SKU series, 1,860,102 training rows, and 13,482 forecast rows per weekly run (E53, E196, E254). Training took about 25 minutes and scoring about 6 (E191, E248).

**6. How do you handle model drift and MLOps?**
- *Exec:* Every model is versioned, gated before it serves, and checked against its features on every run.
- *Technical:*
  - The scoring job asserts a feature-schema hash before it writes forecasts (E197–199).
  - Version 6 is @champion. It was promoted because the corrected festival features changed the schema, not because of an accuracy win: on point accuracy it is level with v5, and we say so (E201–213).
  - Known gaps:
    - stockout weeks are excluded rather than demand-corrected (E563–567)
    - some festival-week peaks are still dampened (E278–279, E568–570)
    - live drift monitoring is next

### CIO backup (quote only if asked)

- **p90 plan-for coverage:** 91–92% of observed store-SKU-weeks landed within the calibrated p90 across both holiday backtests, and 90–95% on peak gifts (E236–241).
- **Backtest dollars (caveat first):** across 25 holiday weeks, the forecast policy had $12.9M less modelled lost sales than the manual policy. Scaled up from peak weeks only, that is $26.8M/yr. It is peak weeks scaled up, not a whole-year estimate, and we don't quote it as a forecast of savings or as support for the $2–3M target. A full-year replay comes first (E314–329, E338–340, E543–547).

### Objection handling

- **"We already have a BI tool and a data warehouse."** Keep them. This isn't a BI replacement; it's the forecast-to-order loop BI can't close. Gold tables are open to your BI through a SQL warehouse, and you avoid adding vendor-to-vendor copies for ML, an OLTP database, and an app host.
- **"Why not buy a point forecasting SaaS?"** A SaaS forecast is another copy of your data, another permission model, and a black box your managers won't trust. Here the festival logic is yours, every order traces back to its source rows, and manager decisions flow back to improve the next forecast.
- **"These numbers are synthetic."** Yes, and we say so on the slides. The synthetic business is calibrated to realistic magnitudes: $160.8M net sales, $17.8M lost sales, and $3.87M waste a year (E58–62, E126–131). That's exactly why the ask is a one-region pilot: to measure on your real data before any finance claim.
- **"Your backtest shows much bigger numbers. Why only $2–3M?"** The backtest figure comes from the two most stressed holiday windows, scaled up. We don't treat it as a whole-year number. $2–3M is the target we'll measure in the pilot, against the $10.3M lost on peak gifts today.
