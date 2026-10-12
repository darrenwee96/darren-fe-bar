# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2.0", "pandas>=2.2"]
# ///
"""Deterministic synthetic sources for Eastwind Gourmet (retail channels only).

Simulation order (see build-plan.md "Generation model"):
  1. master data: locations, products (incl. lead time), holidays; traffic drives demand only
  2. latent daily true demand per ranged location-SKU
  3. daily inventory under the *manual* ordering policy (last-year-same-week x trend)
  4. observed sales = min(true demand, stock), FEFO by receipt cohort, markdowns near expiry,
     write-offs at expiry
  5. five CSV sources in two dated drops; weekly ground truth written separately

A 53-week warm-up (2022-08-29 .. 2023-09-03) gives managers a "last year" to copy
and lets inventory settle. It is simulated but never emitted.

Usage: uv run src/data_generation/generate.py --out <dir> --truth <dir> [--evidence <file>]
"""

import argparse
import math
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42
SIM_START = np.datetime64("2022-08-29")  # Monday; warm-up start
OUT_START = np.datetime64("2023-09-04")  # Monday; first emitted day
OUT_END = np.datetime64("2026-08-30")  # Sunday; last emitted day
INITIAL_DROP = np.datetime64("2026-08-24")  # history through 2026-08-23
INCREMENTAL_DROP = np.datetime64("2026-08-31")  # week 2026-08-24 .. 2026-08-30
SHIFT_START = np.datetime64("2026-03-02")  # highway reroute + new airport terminal

N_DAYS = int((OUT_END - SIM_START).astype(int)) + 1
OUT_T0 = int((OUT_START - SIM_START).astype(int))
OUT_YEARS = (N_DAYS - OUT_T0) / 365.25

CHANNELS = ["DOWNTOWN", "HIGHWAY", "AIRPORT"]
CHANNEL_COUNTS = {"DOWNTOWN": 32, "HIGHWAY": 26, "AIRPORT": 22}
CHANNEL_SOURCE_CODE = {"DOWNTOWN": "DT", "HIGHWAY": "HWY", "AIRPORT": "APT"}
STORE_CODE_PREFIX = {"DOWNTOWN": "DT", "HIGHWAY": "HW", "AIRPORT": "AP"}
# True-demand revenue targets per channel per year (observed ~ $160M after stockouts).
TRUE_REVENUE_TARGET = {"DOWNTOWN": 82e6, "HIGHWAY": 45e6, "AIRPORT": 53e6}
CALIBRATION_TARGETS = {
    "observed_revenue_per_year": (140e6, 180e6),
    "lost_sales_per_year": (14e6, 26e6),
    "waste_value_per_year": (3.5e6, 6.5e6),
}
DOW = {  # Monday..Sunday
    "DOWNTOWN": [0.85, 0.85, 0.9, 0.95, 1.1, 1.25, 1.1],
    "HIGHWAY": [0.8, 0.75, 0.75, 0.8, 1.1, 1.45, 1.35],
    "AIRPORT": [1.0, 0.95, 0.95, 1.0, 1.05, 1.05, 1.0],
}
MARKDOWN_DISCOUNT = 0.40
MANUAL_SAFETY = 1.15
PEAK_OVERBUY = 1.7  # managers pad orders hard when last year shows a spike (they remember selling out)
SPIKE_RATIO = 1.5
WEEK_NOISE_SIGMA = 0.15
MANAGER_NOISE_SIGMA = 0.25  # gut-feel error on each manual order
DAY_DISPERSION = 6.0  # gamma shape for daily demand noise
K_SLOTS = 80  # weekly receipt cohorts kept per series; > max shelf life in weeks

# --- products --------------------------------------------------------------------------
# sku, name, category, gift, peak_gift, shelf_days, case_pack, cost, price, lead_days,
# seasonal (off-season near zero), base daily units at a scale-1 store: (DT, HWY, APT),
# event affinity {event_type: peak extra multiplier}
PRODUCTS = [
    ("MC01", "Classic Lotus Mooncake Box (4pc)", "Mooncake", 1, 1, 30, 12, 15.0, 38.0, 14, 1, (14, 9, 11), {"MID_AUTUMN": 1.0}),
    ("MC02", "Egg Yolk Lotus Mooncake Box (6pc)", "Mooncake", 1, 1, 30, 8, 21.0, 52.0, 14, 1, (12, 7, 9), {"MID_AUTUMN": 1.0}),
    ("MC03", "Snow Skin Mooncake Box", "Mooncake", 1, 1, 14, 8, 17.0, 45.0, 7, 1, (9, 0, 7), {"MID_AUTUMN": 1.0}),
    ("MC04", "Mini Mooncake Travel Pack", "Mooncake", 1, 0, 45, 24, 6.5, 18.0, 14, 1, (0, 12, 14), {"MID_AUTUMN": 1.0}),
    ("PC01", "Pineapple Cake Box (10pc)", "Pastry", 1, 1, 60, 20, 8.0, 22.0, 7, 0, (5, 7, 9), {"LUNAR_NEW_YEAR": 1.8, "MID_AUTUMN": 0.6}),
    ("PC02", "Premium Pineapple Cake Box (20pc)", "Pastry", 1, 1, 60, 10, 14.5, 40.0, 7, 0, (2.5, 2.5, 4), {"LUNAR_NEW_YEAR": 2.2, "MID_AUTUMN": 0.8}),
    ("PC03", "Sun Cake Box (6pc)", "Pastry", 1, 0, 45, 24, 5.5, 16.0, 7, 0, (3, 5, 4), {"LUNAR_NEW_YEAR": 1.0}),
    ("PC04", "Egg Roll Tin", "Pastry", 1, 0, 180, 12, 7.0, 20.0, 14, 0, (2.5, 2, 3), {"LUNAR_NEW_YEAR": 1.5, "CHRISTMAS": 0.4}),
    ("NY01", "Lunar New Year Prosperity Hamper", "Hamper", 1, 1, 180, 4, 40.0, 88.0, 21, 1, (2.2, 0.8, 1.5), {"LUNAR_NEW_YEAR": 1.0}),
    ("NY02", "Nian Gao Rice Cake Gift", "Pastry", 1, 1, 30, 24, 5.0, 15.0, 7, 1, (9, 5, 5), {"LUNAR_NEW_YEAR": 1.0}),
    ("NY03", "Assorted Nut Gift Tin", "Nuts", 1, 0, 270, 12, 12.0, 32.0, 21, 0, (1.5, 1, 1.5), {"LUNAR_NEW_YEAR": 3.0, "CHRISTMAS": 0.8}),
    ("NY04", "Bak Kwa Gift Pack", "Meat", 1, 1, 21, 12, 16.0, 36.0, 7, 1, (9, 4, 6), {"LUNAR_NEW_YEAR": 1.0}),
    ("TE01", "High Mountain Oolong Gift Set", "Tea", 1, 1, 540, 12, 16.0, 48.0, 21, 0, (1.8, 1, 3), {"LUNAR_NEW_YEAR": 1.5, "MID_AUTUMN": 1.0}),
    ("TE02", "Jasmine Tea Tin", "Tea", 0, 0, 365, 24, 5.5, 18.0, 21, 0, (2.5, 1.5, 2.5), {"LUNAR_NEW_YEAR": 0.5}),
    ("TE03", "Tea & Pastry Pairing Box", "Tea", 1, 1, 60, 8, 17.0, 42.0, 14, 0, (1.5, 0.8, 2.5), {"MID_AUTUMN": 2.0, "LUNAR_NEW_YEAR": 1.2}),
    ("NG01", "Milk Nougat Box", "Confectionery", 1, 0, 120, 30, 4.5, 14.0, 7, 0, (4, 5, 6), {"LUNAR_NEW_YEAR": 1.2}),
    ("NG02", "Cranberry Nougat Box", "Confectionery", 1, 0, 120, 30, 5.0, 15.0, 7, 0, (3, 3, 4), {"LUNAR_NEW_YEAR": 1.0, "CHRISTMAS": 0.6}),
    ("NG03", "Peanut Brittle Gift Tin", "Confectionery", 1, 0, 180, 36, 3.8, 12.0, 14, 0, (2.5, 4, 2), {"LUNAR_NEW_YEAR": 1.0}),
    ("SN01", "Dried Mango Pack", "Snack", 0, 0, 270, 48, 3.0, 9.0, 14, 0, (5, 9, 7), {}),
    ("SN02", "Seaweed Crisp Pack", "Snack", 0, 0, 240, 48, 2.2, 7.0, 14, 0, (5, 10, 6), {}),
    ("SN03", "Spicy Dried Tofu Pack", "Snack", 0, 0, 120, 60, 1.8, 6.0, 7, 0, (4, 11, 3), {}),
    ("SN04", "Taro Ball Snack Box", "Snack", 0, 0, 30, 24, 3.8, 11.0, 7, 0, (2, 7, 0), {}),
    ("SA01", "XO Sauce Jar", "Pantry", 1, 0, 365, 12, 9.0, 24.0, 21, 0, (2.5, 0, 1), {"LUNAR_NEW_YEAR": 0.8}),
    ("SA02", "Sesame Oil Gift Bottle", "Pantry", 1, 0, 540, 12, 6.0, 16.0, 21, 0, (2, 0, 0), {"LUNAR_NEW_YEAR": 0.6}),
    ("SA03", "Chili Crisp Jar", "Pantry", 0, 0, 365, 24, 4.0, 12.0, 14, 0, (4, 2, 2), {}),
    ("DG01", "Dried Shiitake Gift Box", "Pantry", 1, 0, 365, 12, 14.0, 34.0, 21, 0, (1.5, 0.5, 1), {"LUNAR_NEW_YEAR": 2.0, "MID_AUTUMN": 0.6}),
    ("DG02", "Bird's Nest Drink 6-pack", "Health", 1, 0, 365, 8, 22.0, 45.0, 21, 0, (1.5, 0.8, 1.5), {"LUNAR_NEW_YEAR": 1.6, "MID_AUTUMN": 1.0}),
    ("XM01", "Holiday Cookie Tin", "Confectionery", 1, 1, 120, 12, 8.5, 25.0, 14, 1, (4, 1.5, 3), {"CHRISTMAS": 1.0}),
    ("XM02", "Chocolate Pastry Assortment", "Pastry", 1, 0, 30, 12, 11.0, 30.0, 7, 0, (1.5, 0, 1.5), {"CHRISTMAS": 2.5}),
    ("DB01", "Zongzi Gift Pack (frozen)", "Seasonal", 1, 0, 90, 12, 11.0, 28.0, 14, 1, (4, 3, 2), {"DRAGON_BOAT": 1.0}),
    ("GB01", "Corporate Gift Box", "Hamper", 1, 1, 180, 6, 28.0, 65.0, 21, 0, (0.8, 0, 0.5), {"MID_AUTUMN": 2.5, "LUNAR_NEW_YEAR": 3.0, "CHRISTMAS": 1.0}),
    ("GB02", "Signature Sampler Box", "Hamper", 1, 0, 60, 10, 13.0, 35.0, 14, 0, (2, 1.5, 3), {"MID_AUTUMN": 0.8, "LUNAR_NEW_YEAR": 0.8}),
]
SKU_LAUNCH = {"GB02": np.datetime64("2025-03-03")}

# --- events ----------------------------------------------------------------------------
# id, name, type, date, window days before, window days after
HOLIDAYS = [
    ("EV2022MA", "Mid-Autumn Festival 2022", "MID_AUTUMN", "2022-09-10", 24, 1),
    ("EV2022XM", "Christmas 2022", "CHRISTMAS", "2022-12-25", 21, 1),
    ("EV2023NY", "Lunar New Year 2023", "LUNAR_NEW_YEAR", "2023-01-22", 28, 5),
    ("EV2023DB", "Dragon Boat Festival 2023", "DRAGON_BOAT", "2023-06-22", 14, 1),
    ("EV2023MA", "Mid-Autumn Festival 2023", "MID_AUTUMN", "2023-09-29", 24, 1),
    ("EV2023ND", "National Day 2023", "TRAVEL_HOLIDAY", "2023-10-10", 3, 2),
    ("EV2023XM", "Christmas 2023", "CHRISTMAS", "2023-12-25", 21, 1),
    ("EV2024NY", "Lunar New Year 2024", "LUNAR_NEW_YEAR", "2024-02-10", 28, 5),
    ("EV2024QM", "Qingming Long Weekend 2024", "TRAVEL_HOLIDAY", "2024-04-04", 3, 2),
    ("EV2024DB", "Dragon Boat Festival 2024", "DRAGON_BOAT", "2024-06-10", 14, 1),
    ("EV2024MA", "Mid-Autumn Festival 2024", "MID_AUTUMN", "2024-09-17", 24, 1),
    ("EV2024ND", "National Day 2024", "TRAVEL_HOLIDAY", "2024-10-10", 3, 2),
    ("EV2024XM", "Christmas 2024", "CHRISTMAS", "2024-12-25", 21, 1),
    ("EV2025NY", "Lunar New Year 2025", "LUNAR_NEW_YEAR", "2025-01-29", 28, 5),
    ("EV2025QM", "Qingming Long Weekend 2025", "TRAVEL_HOLIDAY", "2025-04-04", 3, 2),
    ("EV2025DB", "Dragon Boat Festival 2025", "DRAGON_BOAT", "2025-05-31", 14, 1),
    ("EV2025MA", "Mid-Autumn Festival 2025", "MID_AUTUMN", "2025-10-06", 24, 1),
    ("EV2025ND", "National Day 2025", "TRAVEL_HOLIDAY", "2025-10-10", 3, 2),
    ("EV2025XM", "Christmas 2025", "CHRISTMAS", "2025-12-25", 21, 1),
    ("EV2026NY", "Lunar New Year 2026", "LUNAR_NEW_YEAR", "2026-02-17", 28, 5),
    ("EV2026QM", "Qingming Long Weekend 2026", "TRAVEL_HOLIDAY", "2026-04-04", 3, 2),
    ("EV2026DB", "Dragon Boat Festival 2026", "DRAGON_BOAT", "2026-06-19", 14, 1),
    ("EV2026MA", "Mid-Autumn Festival 2026", "MID_AUTUMN", "2026-09-25", 24, 1),
    ("EV2026ND", "National Day 2026", "TRAVEL_HOLIDAY", "2026-10-10", 3, 2),
    ("EV2026XM", "Christmas 2026", "CHRISTMAS", "2026-12-25", 21, 1),
    ("EV2027NY", "Lunar New Year 2027", "LUNAR_NEW_YEAR", "2027-02-06", 28, 5),
    ("EV2027MA", "Mid-Autumn Festival 2027", "MID_AUTUMN", "2027-09-15", 24, 1),
]
UPLIFT_BAND = {"MID_AUTUMN": "HIGH", "LUNAR_NEW_YEAR": "HIGH", "CHRISTMAS": "MEDIUM", "DRAGON_BOAT": "MEDIUM", "TRAVEL_HOLIDAY": "LOW"}
# How strongly each channel responds to a gifting event.
CHANNEL_EVENT_WEIGHT = {
    "DOWNTOWN": {"MID_AUTUMN": 1.0, "LUNAR_NEW_YEAR": 1.0, "CHRISTMAS": 1.0, "DRAGON_BOAT": 1.0},
    "HIGHWAY": {"MID_AUTUMN": 0.7, "LUNAR_NEW_YEAR": 1.1, "CHRISTMAS": 0.3, "DRAGON_BOAT": 0.9},
    "AIRPORT": {"MID_AUTUMN": 0.9, "LUNAR_NEW_YEAR": 0.9, "CHRISTMAS": 0.7, "DRAGON_BOAT": 0.6},
}

REGIONS = ["North", "Central", "South", "East"]
RNG = np.random.default_rng(SEED)


def days_index(d):
    return int((np.datetime64(d) - SIM_START).astype(int))


def sim_dates():
    return SIM_START + np.arange(N_DAYS)


def event_curve(days_before, window_before, event_type):
    """Gifting curve: ramps over the window, plateau the final week, collapses after."""
    d = days_before
    c = np.zeros_like(d, dtype=float)
    plateau = (d >= 1) & (d <= 8)
    ramp = (d > 8) & (d <= window_before)
    c[plateau] = 1.0
    if window_before > 8:
        c[ramp] = ((window_before - d[ramp]) / (window_before - 8)) ** 1.5
    c[d == 0] = 0.4
    after = (d < 0) & (d >= -5)
    c[after] = 0.25 if event_type == "LUNAR_NEW_YEAR" else 0.02
    return c


# --- master data -----------------------------------------------------------------------
def build_locations():
    names = {
        "DOWNTOWN": ["Zhongshan", "Daan", "Xinyi", "Ximen", "Banqiao", "Tamsui", "Hsinchu Central", "Taichung Park", "Tainan Old Town", "Kaohsiung Harbour"],
        "HIGHWAY": ["Qingshui", "Guanxi", "Hukou", "Taian", "Xihu", "Dongshan", "Rende", "Gukeng", "Nantou", "Xinying"],
        "AIRPORT": ["Taoyuan T1", "Taoyuan T2", "Songshan", "Taichung Intl", "Kaohsiung Intl", "Tainan"],
    }
    rows = []
    lid = 1
    for ch in CHANNELS:
        for i in range(CHANNEL_COUNTS[ch]):
            base = names[ch][i % len(names[ch])]
            n = i // len(names[ch])
            if ch == "HIGHWAY":
                lname = f"{base} Service Area {'N' if n % 2 == 0 else 'S'}"
            elif ch == "AIRPORT":
                lname = f"{base} Airport Store {chr(65 + n)}"
            else:
                lname = f"{base} Shop" + (f" {n + 1}" if n else "")
            tier = RNG.choice(["S", "M", "L"], p=[0.3, 0.45, 0.25])
            scale = float({"S": 0.65, "M": 1.0, "L": 1.45}[tier] * RNG.lognormal(0, 0.25))
            rows.append({
                "location_id": f"L{lid:04d}",
                "location_name": lname,
                "channel": ch,
                "region": REGIONS[i % 4] if ch != "AIRPORT" else REGIONS[[0, 0, 0, 1, 2, 2][i % 6]],
                "capacity_tier": tier,
                "timezone": "Asia/Taipei",
                "pos_store_code": f"{STORE_CODE_PREFIX[ch]}{i + 1:03d}",
                "opened_date": str(np.datetime64("2015-01-01") + np.timedelta64(int(RNG.integers(0, 2500)), "D")),
                "scale": scale,
            })
            lid += 1
    loc = pd.DataFrame(rows)
    hw = loc.index[loc.channel == "HIGHWAY"][[2, 7, 12, 17]]  # reroute: -30% traffic
    ap = loc.index[loc.channel == "AIRPORT"][[1, 4]]  # new terminal: +25% traffic
    loc["shift_factor"] = 1.0
    loc.loc[hw, "shift_factor"] = 0.70
    loc.loc[ap, "shift_factor"] = 1.25
    return loc


def build_products():
    cols = ["sku", "sku_name", "category", "gift_flag", "peak_gift_flag", "shelf_life_days", "case_pack_units",
            "unit_cost", "list_price", "lead_time_days", "seasonal", "base", "affinity"]
    p = pd.DataFrame(PRODUCTS, columns=cols)
    p["sku_id"] = "SKU-" + p["sku"]
    return p


def build_assortment(loc, prod):
    """Series = ranged (location, sku). Small stores drop some non-core SKUs."""
    rows = []
    ch_i = {c: i for i, c in enumerate(CHANNELS)}
    for li, l in loc.iterrows():
        for pi, p in prod.iterrows():
            base = p["base"][ch_i[l["channel"]]]
            if base <= 0:
                continue
            if l["capacity_tier"] == "S" and not p["peak_gift_flag"] and RNG.random() < 0.25:
                continue
            ranged_from = SKU_LAUNCH.get(p["sku"], np.datetime64("2019-01-01"))
            rows.append({"li": li, "pi": pi, "base": base, "ranged_from": ranged_from})
    return pd.DataFrame(rows)


def build_traffic(loc):
    """Weekly traffic index (100 = normal) for highway and airport stores. Drives demand only."""
    n_weeks = N_DAYS // 7 + 1
    weeks = SIM_START + 7 * np.arange(n_weeks)
    month = (weeks.astype("datetime64[M]").astype(int) % 12) + 1
    idx = np.full((len(loc), n_weeks), 100.0)
    for li, l in loc.iterrows():
        if l["channel"] == "DOWNTOWN":
            continue
        season = np.ones(n_weeks)
        if l["channel"] == "AIRPORT":
            season *= np.where(np.isin(month, [7, 8]), 1.15, 1.0) * np.where(np.isin(month, [2, 10]), 1.06, 1.0)
        for hid, name, etype, d, wb, wa in HOLIDAYS:
            ed = np.datetime64(d)
            near = (weeks >= ed - np.timedelta64(6, "D")) & (weeks <= ed + np.timedelta64(3, "D"))
            if etype == "LUNAR_NEW_YEAR":
                season *= np.where(near, 1.40 if l["channel"] == "HIGHWAY" else 1.15, 1.0)
            elif etype in ("TRAVEL_HOLIDAY", "DRAGON_BOAT", "MID_AUTUMN"):
                season *= np.where(near, 1.20 if l["channel"] == "HIGHWAY" else 1.08, 1.0)
        shift = np.where(weeks >= SHIFT_START, l["shift_factor"], 1.0)
        idx[li] = np.round(100 * season * shift * RNG.normal(1, 0.03, n_weeks), 1)
    return idx


# --- demand ----------------------------------------------------------------------------
def expected_demand(loc, prod, ser, traffic_idx):
    """Mean daily demand per series before noise and channel scaling."""
    t = np.arange(N_DAYS)
    dates = sim_dates()
    dow = t % 7
    week = t // 7
    curves = {}
    for hid, name, etype, d, wb, wa in HOLIDAYS:
        if etype == "TRAVEL_HOLIDAY":
            continue
        curves.setdefault(etype, np.zeros(N_DAYS))
        curves[etype] += event_curve(days_index(d) - t, wb, etype)
    lam = np.zeros((len(ser), N_DAYS))
    for si, s in enumerate(ser.itertuples()):
        l = loc.loc[s.li]
        p = prod.loc[s.pi]
        ch = l["channel"]
        events = np.zeros(N_DAYS)
        for etype, a in p["affinity"].items():
            events += a * CHANNEL_EVENT_WEIGHT[ch].get(etype, 0) * curves[etype]
        mult = (0.02 + events) if p["seasonal"] else (1.0 + events)
        traffic = traffic_idx[s.li, week] / 100.0 if ch != "DOWNTOWN" else 1.0
        trend = 1.0 + 0.03 * (t - OUT_T0) / 365.25 if ch == "DOWNTOWN" else 1.0
        ranged = dates >= s.ranged_from
        lam[si] = s.base * l["scale"] * np.asarray(DOW[ch])[dow] * mult * traffic * trend * ranged
    return lam


def calibrate_scale(ser_ch, lam, unit_price):
    """Per-channel factor so expected true-demand revenue hits the yearly target."""
    out = slice(OUT_T0, N_DAYS)
    factors = {}
    for c in CHANNELS:
        m = ser_ch == c
        rev = (lam[m, out] * unit_price[m, None]).sum() / OUT_YEARS
        factors[c] = TRUE_REVENUE_TARGET[c] / rev
        lam[m] *= factors[c]
    return factors


def sample_demand(lam):
    n = lam.shape[0]
    n_weeks = math.ceil(N_DAYS / 7)
    z = np.zeros((n, n_weeks))
    eps = RNG.normal(0, WEEK_NOISE_SIGMA, (n, n_weeks))
    for w in range(1, n_weeks):
        z[:, w] = 0.7 * z[:, w - 1] + eps[:, w]
    week_noise = np.exp(np.repeat(z, 7, axis=1)[:, :N_DAYS] - WEEK_NOISE_SIGMA**2)
    mu = lam * week_noise * RNG.gamma(DAY_DISPERSION, 1 / DAY_DISPERSION, lam.shape)
    return RNG.poisson(mu)


# --- inventory simulation under the manual policy -------------------------------------
def simulate(ser, prod, demand, lam):
    n = len(ser)
    shelf = prod.loc[ser["pi"], "shelf_life_days"].to_numpy()
    lead = prod.loc[ser["pi"], "lead_time_days"].to_numpy()
    case_pack = prod.loc[ser["pi"], "case_pack_units"].to_numpy()
    seasonal = prod.loc[ser["pi"], "seasonal"].to_numpy() == 1
    md_window = np.clip(np.round(0.3 * shelf), 3, 30).astype(int)
    big = 10**9
    Q = np.zeros((n, K_SLOTS), dtype=np.int64)
    E = np.full((n, K_SLOTS), big, dtype=np.int64)
    arrivals = np.zeros((n, N_DAYS + 40), dtype=np.int64)
    inbound = np.zeros(n, dtype=np.int64)
    rec = {k: np.zeros((n, N_DAYS), dtype=np.int64) for k in
           ("sold", "md_units", "expired", "on_hand", "inbound", "received")}

    n_weeks = N_DAYS // 7 + 1
    weekly_sales = np.zeros((n, n_weeks))
    exp_week = np.zeros((n, n_weeks))
    full = (N_DAYS // 7) * 7
    exp_week[:, : full // 7] = lam[:, :full].reshape(n, -1, 7).sum(axis=2)
    exp_week[:, full // 7:] = exp_week[:, full // 7 - 1: full // 7]
    cover_weeks = lead // 7 + 1
    rows = np.arange(n)

    # Opening stock: two weeks of expected demand.
    open_qty = np.ceil(exp_week[:, 0:2].sum(axis=1) / case_pack) * case_pack
    Q[:, 0] = open_qty.astype(np.int64)
    E[:, 0] = np.where(open_qty > 0, shelf, big)

    for t in range(N_DAYS):
        # 1. receipts (one cohort per series per week)
        arr = arrivals[:, t]
        got = arr > 0
        slot = (t // 7) % K_SLOTS
        Q[got, slot] = arr[got]
        E[got, slot] = t + shelf[got]
        inbound -= arr
        rec["received"][:, t] = arr
        # 2. expiry write-off
        exp_mask = (E <= t) & (Q > 0)
        rec["expired"][:, t] = (Q * exp_mask).sum(axis=1)
        Q[exp_mask] = 0
        E[E <= t] = big
        # 3. sales, FEFO; units from cohorts near expiry sell at a markdown
        sold = np.minimum(demand[:, t], Q.sum(axis=1))
        order = np.argsort(E, axis=1)
        Qs = np.take_along_axis(Q, order, axis=1)
        Es = np.take_along_axis(E, order, axis=1)
        prev = np.cumsum(Qs, axis=1) - Qs
        take = np.clip(sold[:, None] - prev, 0, Qs)
        np.put_along_axis(Q, order, Qs - take, axis=1)
        rec["md_units"][:, t] = (take * ((Es - t) <= md_window[:, None])).sum(axis=1)
        rec["sold"][:, t] = sold
        weekly_sales[:, t // 7] += sold
        rec["on_hand"][:, t] = Q.sum(axis=1)
        rec["inbound"][:, t] = inbound
        # 4. Monday review: manual order-up-to policy
        if t % 7 == 0 and t > 0:
            w = t // 7
            trail = weekly_sales[:, max(0, w - 4):w].mean(axis=1)
            fc = np.zeros(n)
            spike = np.zeros(n, dtype=bool)
            for j in range(cover_weeks.max()):
                use = j < cover_weeks
                tw = w + j
                if tw - 52 >= 0 and w - 56 >= 0:
                    ly = weekly_sales[:, tw - 52]
                    ly_trail = weekly_sales[:, w - 56:w - 52].mean(axis=1)
                    ratio = np.where(ly_trail > 0, np.clip(trail / np.maximum(ly_trail, 1e-9), 0.8, 1.25), 1.0)
                    f = 0.7 * ly * ratio + 0.3 * trail
                    # No last-year history for a core line (new SKU): fall back to recent sales.
                    f = np.where(~seasonal & (ly_trail == 0) & (trail > 0), trail, f)
                    spike |= use & (ly > SPIKE_RATIO * np.maximum(trail, 1))
                else:  # warm-up: experienced planner, event-aware, imprecise
                    ref = exp_week[:, max(0, w - 2):w].mean(axis=1)
                    f = np.where(ref > 0, trail * exp_week[:, tw] / np.maximum(ref, 1e-9), exp_week[:, tw])
                    f *= RNG.uniform(0.8, 1.2, n)
                fc += np.where(use, f, 0)
            # New SKU launch: planner seeds with an expected-volume guess.
            launching = (fc <= 0) & (exp_week[:, w:w + 2].sum(axis=1) > 0) & (weekly_sales[:, max(0, w - 8):w].sum(axis=1) == 0)
            fc[launching] = exp_week[launching, w:w + 2].sum(axis=1)
            target = MANUAL_SAFETY * fc * np.where(spike, PEAK_OVERBUY, 1.0)
            target *= RNG.lognormal(-MANAGER_NOISE_SIGMA**2 / 2, MANAGER_NOISE_SIGMA, n)
            # Display minimum: keep at least one case on shelf for core (non-seasonal) lines.
            target = np.where(~seasonal & (exp_week[:, w] > 0), np.maximum(target, case_pack), target)
            position = Q.sum(axis=1) + inbound
            qty = (np.ceil(np.maximum(0, target - position) / case_pack) * case_pack).astype(np.int64)
            arrivals[rows, t + lead] += qty
            inbound += qty
    return rec


# --- emit ------------------------------------------------------------------------------
def write_facts(df, out, source, date_col):
    """Initial drop: one file per month of history. Incremental drop: one file for the last week."""
    dates = pd.to_datetime(df[date_col]).to_numpy().astype("datetime64[D]")
    late = dates >= INITIAL_DROP
    folder = out / source / str(INITIAL_DROP)
    folder.mkdir(parents=True, exist_ok=True)
    hist = df[~late]
    for m, g in hist.groupby(hist[date_col].astype(str).str[:7]):
        g.to_csv(folder / f"{source}_{m}.csv", index=False)
    folder = out / source / str(INCREMENTAL_DROP)
    folder.mkdir(parents=True, exist_ok=True)
    df[late].to_csv(folder / f"{source}_{INCREMENTAL_DROP}.csv", index=False)
    return {str(INITIAL_DROP): int((~late).sum()), str(INCREMENTAL_DROP): int(late.sum())}


def write_static(df, out, source):
    folder = out / source / str(INITIAL_DROP)
    folder.mkdir(parents=True, exist_ok=True)
    df.to_csv(folder / f"{source}.csv", index=False)
    return {str(INITIAL_DROP): len(df)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--truth", required=True, type=Path, help="Ground-truth output dir (kept out of the landing volume)")
    ap.add_argument("--evidence", type=Path)
    args = ap.parse_args()
    out, truth = args.out, args.truth
    out.mkdir(parents=True, exist_ok=True)
    truth.mkdir(parents=True, exist_ok=True)

    loc = build_locations()
    prod = build_products()
    ser = build_assortment(loc, prod)
    traffic_idx = build_traffic(loc)
    lam = expected_demand(loc, prod, ser, traffic_idx)
    ser_ch = loc.loc[ser["li"], "channel"].to_numpy()
    unit_price = prod.loc[ser["pi"], "list_price"].to_numpy()
    scale = calibrate_scale(ser_ch, lam, unit_price)
    demand = sample_demand(lam)
    rec = simulate(ser, prod, demand, lam)

    dates = sim_dates()
    o = slice(OUT_T0, N_DAYS)
    sku_id = prod.loc[ser["pi"], "sku_id"].to_numpy()
    loc_id = loc.loc[ser["li"], "location_id"].to_numpy()
    unit_cost = prod.loc[ser["pi"], "unit_cost"].to_numpy()
    counts = {}

    # Long-form helper over (series, day) for emitted days.
    S, T = np.meshgrid(np.arange(len(ser)), np.arange(OUT_T0, N_DAYS), indexing="ij")
    S, T = S.ravel(), T.ravel()

    def col(name):
        return rec[name][:, o].ravel()

    sold, md, expired = col("sold"), col("md_units"), col("expired")
    up = unit_price[S]
    gross = np.round(sold * up, 2)
    disc = np.round(md * up * MARKDOWN_DISCOUNT, 2)
    bdate = dates[T]
    ch = ser_ch[S]
    ranged_from = ser["ranged_from"].to_numpy()[S]

    # POS sales: one shared POS across all store formats, end-of-day item summary by store code.
    m = sold > 0
    store_code = loc.set_index("location_id")["pos_store_code"]
    pos = pd.DataFrame({
        "business_date": bdate[m].astype(str),
        "store_code": store_code.loc[loc_id[S[m]]].to_numpy(),
        "item_code": sku_id[S[m]],
        "units": sold[m],
        "gross_amount": gross[m],
        "discount_amount": disc[m],
        "net_amount": np.round(gross[m] - disc[m], 2),
    })
    # Planted quality issues: duplicate rows, returns posted as negative units, unknown store.
    dup = pos.sample(frac=0.003, random_state=SEED)
    bad = pos.sample(n=40, random_state=SEED + 1).copy()
    bad.iloc[:20, bad.columns.get_loc("units")] = -RNG.integers(1, 4, 20)
    bad.iloc[20:, bad.columns.get_loc("store_code")] = "DT099"
    pos = pd.concat([pos, dup, bad]).sort_values(["business_date", "store_code", "item_code"], kind="stable")
    counts["pos_sales"] = write_facts(pos, out, "pos_sales", "business_date")

    # ERP inventory: daily position per ranged location-SKU, with receipts, expiry write-offs,
    # and units sold at a markdown.
    m = bdate >= ranged_from
    inv = pd.DataFrame({
        "snapshot_date": bdate[m].astype(str),
        "location_id": loc_id[S[m]],
        "sku_id": sku_id[S[m]],
        "on_hand_units": col("on_hand")[m],
        "inbound_units": col("inbound")[m],
        "received_units": col("received")[m],
        "expired_units": expired[m],
        "markdown_units": md[m],
    })
    counts["inventory_daily"] = write_facts(inv, out, "inventory_daily", "snapshot_date")

    counts["products"] = write_static(pd.DataFrame({
        "sku_id": prod["sku_id"], "sku_name": prod["sku_name"], "category": prod["category"],
        "gift_flag": np.where(prod["gift_flag"] == 1, "Y", "N"), "peak_gift_flag": np.where(prod["peak_gift_flag"] == 1, "Y", "N"),
        "shelf_life_days": prod["shelf_life_days"], "case_pack_units": prod["case_pack_units"],
        "lead_time_days": prod["lead_time_days"], "unit_cost": prod["unit_cost"], "list_price": prod["list_price"],
        "launch_date": [str(SKU_LAUNCH.get(s, "")) for s in prod["sku"]],
    }), out, "products")
    counts["locations"] = write_static(loc.assign(channel_code=loc["channel"].map(CHANNEL_SOURCE_CODE), active_flag="Y")[
        ["location_id", "location_name", "channel_code", "region", "capacity_tier", "timezone",
         "pos_store_code", "opened_date", "active_flag"]], out, "locations")
    counts["holidays"] = write_static(pd.DataFrame([{
        "holiday_id": h, "holiday_name": nm, "event_type": e, "event_date": d,
        "window_start": str(np.datetime64(d) - np.timedelta64(wb, "D")),
        "window_end": str(np.datetime64(d) + np.timedelta64(wa, "D")),
        "expected_uplift_band": UPLIFT_BAND[e]} for h, nm, e, d, wb, wa in HOLIDAYS]), out, "holidays")

    # Ground truth (never in the landing volume): weekly true vs observed demand.
    true_d = demand[S, T]
    gt = pd.DataFrame({"s": S, "w": (T - OUT_T0) // 7, "true_units": true_d, "observed_units": sold, "lam": lam[S, T]})
    gt = gt.groupby(["s", "w"], as_index=False).sum()
    pd.DataFrame({
        "location_id": loc_id[gt["s"]], "sku_id": sku_id[gt["s"]],
        "week_start": (OUT_START + 7 * gt["w"].to_numpy()).astype(str),
        "true_units": gt["true_units"], "observed_units": gt["observed_units"],
        "lost_units": gt["true_units"] - gt["observed_units"], "expected_units": np.round(gt["lam"], 3),
    }).to_csv(truth / "true_demand_weekly.csv", index=False)

    # Calibration summary.
    lost = (true_d - sold) * up
    expiry_cost = expired * unit_cost[S]
    obs_rev = (gross - disc).sum() / OUT_YEARS
    waste_val = (expiry_cost.sum() + disc.sum()) / OUT_YEARS
    lines = ["Eastwind Gourmet synthetic data — calibration", f"seed={SEED}  history={OUT_START}..{OUT_END}  years={OUT_YEARS:.2f}", ""]
    lines.append(f"series (ranged location-SKU): {len(ser)}   stores: {len(loc)}   SKUs: {len(prod)}")
    lines.append("channel scale factors: " + ", ".join(f"{k}={v:.3f}" for k, v in scale.items()))
    lines.append("")
    lines.append(f"{'metric':<34}{'actual/yr':>16}{'target band':>28}  ok")
    for k, v in [("observed_revenue_per_year", obs_rev), ("lost_sales_per_year", lost.sum() / OUT_YEARS), ("waste_value_per_year", waste_val)]:
        lo, hi = CALIBRATION_TARGETS[k]
        lines.append(f"{k:<34}{v:>16,.0f}{f'{lo:,.0f} – {hi:,.0f}':>28}  {'PASS' if lo <= v <= hi else 'FAIL'}")
    lines.append("")
    lines.append("by channel (per year)          true_rev     observed_rev      lost_sales   expiry_cost  markdown_disc")
    for c in CHANNELS:
        mc = ch == c
        lines.append(f"  {c:<26}{(true_d[mc] * up[mc]).sum() / OUT_YEARS:>12,.0f}{(gross[mc] - disc[mc]).sum() / OUT_YEARS:>17,.0f}"
                     f"{lost[mc].sum() / OUT_YEARS:>16,.0f}{expiry_cost[mc].sum() / OUT_YEARS:>14,.0f}{disc[mc].sum() / OUT_YEARS:>15,.0f}")
    pk = prod.loc[ser["pi"], "peak_gift_flag"].to_numpy()[S] == 1
    active = (bdate >= ranged_from) & (lam[S, T] > 0.05)
    lines.append("")
    lines.append(f"share of lost sales on peak gift SKUs: {lost[pk].sum() / max(1, lost.sum()):.1%}")
    lines.append(f"stockout days / ranged series-days: {((col('on_hand') == 0) & active).sum() / max(1, active.sum()):.1%}")
    lines.append("")
    lines.append("rows written per source and drop:")
    for src, c in counts.items():
        lines.append(f"  {src:<18}" + "  ".join(f"{d}: {n:,}" for d, n in c.items()))
    report = "\n".join(lines) + "\n"
    print(report)
    if args.evidence:
        args.evidence.parent.mkdir(parents=True, exist_ok=True)
        args.evidence.write_text(report)


if __name__ == "__main__":
    main()
