# Eastwind Gourmet · Forecast-driven replenishment

Business deck, text export. Nine slides, each with its speaker notes in tell-show-tell form. The visual version is `index.html` and `eastwind-deck.pdf`. Every figure comes from `evidence/EVIDENCE.txt` or `industry-problem.md`.

Audience: the VP Merchandising (executive sponsor, who owns lost sales, waste, and margin) and the CIO (domain owner for data and the ordering process).

---

## Slide 1 · Forecast-driven replenishment

**Eastwind Gourmet · Specialty food retail**

You can’t forecast a gift box for a highway kiosk the way you do downtown.

For the VP Merchandising and the CIO · October 2026

**Speaker notes**
- Tell: "Today I'll show you how Eastwind can order from a forecast your managers trust, and what that's worth in recovered sales."
- Show: the one-liner. The same gift box sells differently downtown, at a highway kiosk, and at an airport, and holidays make that harder.
- Tell: "We'll start with the outcome, then the problem, then the build, and finish with a pilot ask."

---

## Slide 2 · The outcome: what you get

| KPI | Value | What it means | Proof |
|---|---|---|---|
| Forecast error | **43–49% lower** | lower than today's method, in both holiday seasons | WMAPE 0.24–0.25 vs 0.44–0.46 for last-year-same-week overall; 36–50% lower in each channel |
| Plan-for coverage | **91–92%** | of store-SKU-weeks land within the p90 plan-for quantity | The calibrated p90 band drives safety stock, so you know how much buffer you're buying |
| Lost sales recovered (target) | **$2–3M/yr** | 10–15% of today's $17.8M/yr lost sales | Conservative: the peak-season backtest cut modelled lost sales in every channel and every holiday window |

- **VP Merchandising:** fuller shelves on peak gifts, and orders your managers trust.
- **CIO:** one governed flow from POS to order, traceable end to end.

**Speaker notes**
- Tell: "Here's the result in your KPIs first."
- Show: overall forecast error is 43–49% lower than last-year-same-week in both holiday backtests, and 36–50% lower channel by channel. The p90 plan-for covers 91–92% of weeks, so safety stock is calibrated, not guessed. The value target is $2–3M a year of recovered lost sales, which is 10–15% of the $17.8M lost today.
- Tell: "That $2–3M is deliberately conservative. The peak-season backtest, which I'll show on slide 8, points much higher. For the VP: fewer empty shelves on gifts. For the CIO: one governed pipeline."

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
- Tell: "Why this matters to your P&L."
- Show: 80 stores in three formats with very different demand. Ordering by experience loses $17.8M a year in sales from empty shelves and $3.87M a year in expired and marked-down stock. Peaks are the worst: about one in five peak-gift store-days were out of stock in Mid-Autumn 2025, and peak gifts carry 57.5% of lost sales.
- Tell: "So the money is in peak gifts, which is where the forecast has to be best."

---

## Slide 4 · Why it’s hard (for the CIO)

1. **Five siloed sources:** POS, ERP inventory, product catalog, store master, holiday calendar. Each has its own owner, format, and refresh cycle. Even store IDs differ: POS says `DT001`, ERP says `L0001`.
2. **Stockouts hide demand.** When the shelf is empty, sales stop, so history understates what customers wanted. One mooncake line was out of stock 6 and 7 days in its two peak weeks.
3. **Festivals move.** Lunar holidays land in a different week each year: Mid-Autumn fell on Sep 17 in 2024 and Oct 6 in 2025. Last-year-same-week under-forecasts peak gifts by 30–39%.

**Speaker notes**
- Tell: "Three technical reasons a spreadsheet can't fix this."
- Show: five sources that don't share keys. Sales history that undercounts demand exactly when it matters most. Festivals that move, so 'same week last year' points at the wrong week and under-forecasts peak gifts by 30–39%.
- Tell: "The architecture on the next slide is built to fix these three problems."

---

## Slide 5 · Architecture: one governed flow

Raw files → Lakeflow → Unity Catalog → ML forecast → Lakebase → App + Genie Agent, with decisions flowing back to gold.

- **Raw files (five sources):** POS sales, ERP inventory, product catalog, store master, holiday calendar
- **Lakeflow:** incremental ingest; bronze, silver, gold; expectations and quarantine
- **Unity Catalog:** governed tables, least-privilege grants, lineage to source
- **ML forecast:** LightGBM at store × SKU × week; MLflow with an @champion gate; conformal p90 band
- **Lakebase:** recommended orders, manager decisions, append-only audit trail
- **App + Genie Agent:** managers review and approve; planners ask in plain language
- **Loop:** manager decisions flow back to gold.

One weekly job refreshes data, scores the @champion model, builds orders, loads Lakebase, and ingests decisions.

**Speaker notes**
- Tell: "One flow, left to right, on one platform."
- Show: Lakeflow ingests the five feeds incrementally and quarantines bad rows. Unity Catalog governs and traces every table. The LightGBM forecast is tracked in MLflow and only serves once it passes the @champion gate. Recommendations and manager decisions live in Lakebase with a full audit trail. Managers use the App, planners use Genie, and decisions flow back to gold so the next forecast learns from them.
- Tell: "For the CIO: nothing is stitched together. Every recommendation traces back to the raw POS and ERP feeds."

---

## Slide 6 · How it works: pain point to result

| Pain point | Databricks capability | Result |
|---|---|---|
| Fragmented data | Lakeflow + Unity Catalog: one governed view | 0 mismatched weeks; 40 bad rows quarantined |
| Hidden demand | Stockout-aware training excludes censored weeks | Peak-gift bias cut from 30–39% to 6–9% |
| Holiday swings | Festival-aligned features | Peak-gift error 0.25–0.31 vs 0.46–0.58 |
| Distrust | Reasons in units, plus a p90 band on every line | Peak-gift demand within p90 in 90–95% of weeks |
| Slow decisions | One-click approve in the App, on Lakebase | Accept, adjust, or reject with a reason, all audited |
| Ad-hoc questions | Genie Agent on governed gold tables | 11 of 11 benchmark questions correct, SQL shown |

Error = WMAPE; baseline = last-year-same-week. Mid-Autumn 2025 and Lunar New Year 2026 backtests.

**Speaker notes**
- Tell: "Each pain point maps to one capability and one measured result."
- Show: gold reconciles to source with zero mismatched weeks. Training ignores stockout weeks, so peak-gift under-forecasting drops from 30–39% to 6–9%. Festival-aligned features cut peak-gift error to 0.25–0.31 from 0.46–0.58. Every line shows its reason in units and a p90 band. Managers approve with one click. Genie answered 11 of 11 benchmark questions.
- Tell: "Trust is the adoption lever. If managers can see why, they'll order from it."

---

## Slide 7 · The app: what managers see

Screenshot of the deployed Databricks App (control panel), with three callouts:
1. **KPI strip:** peak gifts at risk, forecast error, waste, and adoption at a glance.
2. **Order queue:** ranked by sales at risk. Accept in one click, or adjust with a reason. (Inset: the decision panel with Accept, Save adjusted quantity, and Reject.)
3. **Ask Genie:** plain-language questions, answered with your access and the SQL shown.

**Speaker notes**
- Tell: "This is the store manager's day."
- Show: the KPI strip at the top. The queue ranked by sales at risk, where one click accepts and an adjustment needs a reason. Genie, docked on the right, runs as the signed-in user, so it only sees data that user can access in Unity Catalog, and it shows its SQL.
- Tell: "One screen to review, understand, and approve, which is exactly the 'what good looks like' in your brief."

---

## Slide 8 · Impact and proof: proven vs next

| Success measure | Evidence | Status | Next |
|---|---|---|---|
| Forecast accuracy by channel | WMAPE 23.6–26.6% vs 38.1–47.7% today | Proven | Track live by channel |
| Stockouts on peak gift SKUs | Modelled lost sales down in every window and channel (baseline: 18.7–21.1% of peak-gift days out) | Simulated | Measure in the pilot |
| Expired and marked-down value | Flat: +$42k/yr in the backtest (baseline: $3.87M/yr) | Not yet | Waste-aware policy, phase 2 |
| Orders placed from forecast | Test decisions only so far | Not yet | Track in the pilot |

**Peak-season backtest: $26.8M/yr** of lost sales avoided vs manual ordering, pooled across 25 holiday weeks. This figure is annualised from peak windows only and isn't a whole-year estimate. It shows the $2–3M/yr target is conservative.

The policy backtest is a simulation on synthetic data. A full-year replay comes before any finance claim.

**Speaker notes**
- Tell: "Here's what's proven and what's next, with no overselling."
- Show: accuracy is proven by channel. Stockout reduction is shown in simulation: modelled lost sales fell in every holiday window and channel, and pooled across 25 peak weeks that annualises to $26.8M. That figure comes from peak weeks only, so we don't quote it as a whole-year number. It's why $2–3M is a safe target. Waste is flat today (+$42k a year), so a waste-aware order policy is phase 2. Adoption so far is test decisions only.
- Tell: "Accuracy is proven. Stockout value is strongly indicated. The pilot measures the rest."

---

## Slide 9 · Roadmap: 30 / 60 / 90 days

- **Day 30, governance pack:** row filters by region, column masks on cost, persona groups, lineage in UC.
- **Day 60, waste-aware ordering:** add shelf-life and waste limits to the order rule; replay a full year.
- **Day 90, one-region pilot:** managers order from the app; you measure all four success measures live.

**The ask: approve a one-region pilot.** You get live proof on stockouts, waste, and adoption before a network-wide rollout.

**Speaker notes**
- Tell: "Here's how we get from backtest to proof in your stores."
- Show: in 30 days, close the governance gaps. In 60 days, make ordering waste-aware and replay a full year. In 90 days, run a one-region pilot and measure all four success measures live.
- Tell: "The ask is simple: approve a one-region pilot. You risk little and get real numbers before you scale."
