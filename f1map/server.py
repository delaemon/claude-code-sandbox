from __future__ import annotations

"""F1 Race Map – FastAPI backend.

Data source: FastF1 (accesses F1's official Live Timing API).
All heavy work runs in a thread pool to avoid blocking the event loop.
Results are cached on disk so subsequent loads are instant.
"""
import json
import math
from pathlib import Path

import fastf1
import numpy as np
import pandas as pd
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

# ── cache setup ──────────────────────────────────────────────────────────────

CACHE_DIR = Path("cache")
DATA_DIR = Path("data_cache")
for d in [CACHE_DIR, DATA_DIR]:
    d.mkdir(exist_ok=True)

fastf1.Cache.enable_cache(str(CACHE_DIR))

# ── app ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="F1 Race Map")
app.add_middleware(GZipMiddleware, minimum_size=1000)

SAMPLE_HZ = 4  # position / telemetry output rate


# ── helpers ───────────────────────────────────────────────────────────────────

def _key(year: int, rnd: int, stype: str) -> str:
    return f"{year}_{rnd}_{stype}"


def _td(td) -> float | None:
    """Convert timedelta to seconds, or None."""
    return None if pd.isna(td) else round(td.total_seconds(), 3)


def _t_ref(session) -> pd.Timestamp:
    try:
        return session.t0_date
    except AttributeError:
        dates = [p["Date"].min() for p in session.pos_data.values() if not p.empty]
        return min(dates)


def _resample(t_src: np.ndarray, v_src: np.ndarray, t_out: np.ndarray) -> list:
    """Linearly interpolate v_src onto t_out; returns list with None for out-of-range."""
    v_interp = np.interp(t_out, t_src, v_src, left=np.nan, right=np.nan)
    return [None if math.isnan(v) else round(float(v), 1) for v in v_interp]


# ── sync loaders (run inside thread pool) ────────────────────────────────────

def _load_schedule(year: int) -> list:
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    result = []
    for _, row in schedule.iterrows():
        result.append({
            "round": int(row["RoundNumber"]),
            "name": str(row["EventName"]),
            "country": str(row["Country"]),
            "location": str(row.get("Location", "")),
            "date": str(row["EventDate"].date()),
        })
    return result


def _load_info(year: int, rnd: int, stype: str) -> dict:
    cf = DATA_DIR / f"{_key(year, rnd, stype)}_info.json"
    if cf.exists():
        return json.loads(cf.read_text())

    session = fastf1.get_session(year, rnd, stype)
    session.load(telemetry=False, laps=True, messages=False)

    drivers: dict = {}
    for num in session.drivers:
        try:
            info = session.get_driver(num)
            color = (info.get("TeamColor") or "888888").strip("#")
            drivers[num] = {
                "number": num,
                "name": str(info.get("FullName", num)),
                "abbreviation": str(info.get("Abbreviation", num)),
                "team": str(info.get("TeamName", "Unknown")),
                "color": f"#{color}",
            }
        except Exception:
            drivers[num] = {
                "number": num, "name": num, "abbreviation": num,
                "team": "Unknown", "color": "#888888",
            }

    result = {
        "year": year,
        "event": str(session.event["EventName"]),
        "circuit": str(session.event.get("Location", "")),
        "session": stype,
        "drivers": drivers,
    }
    cf.write_text(json.dumps(result))
    return result


def _load_positions(year: int, rnd: int, stype: str) -> dict:
    cf = DATA_DIR / f"{_key(year, rnd, stype)}_positions.json"
    if cf.exists():
        return json.loads(cf.read_text())

    session = fastf1.get_session(year, rnd, stype)
    session.load(telemetry=True, laps=True, messages=False)

    t_ref = _t_ref(session)

    # Collect per-driver position arrays
    drv_data: dict[str, dict] = {}
    all_x: list = []
    all_y: list = []

    for drv, raw in session.pos_data.items():
        if raw is None or raw.empty:
            continue
        raw = raw[["Date", "X", "Y"]].dropna().copy()
        if len(raw) < 2:
            continue
        raw["t"] = (raw["Date"] - t_ref).dt.total_seconds()
        raw = raw[raw["t"] >= 0].sort_values("t").drop_duplicates("t")
        t_v = raw["t"].values
        x_v = raw["X"].values.astype(float)
        y_v = raw["Y"].values.astype(float)
        all_x.extend(x_v.tolist())
        all_y.extend(y_v.tolist())
        drv_data[drv] = {"t": t_v, "x": x_v, "y": y_v}

    if not drv_data:
        raise ValueError("No position data found for this session.")

    # Global time axis at SAMPLE_HZ
    g_min = min(d["t"].min() for d in drv_data.values())
    g_max = max(d["t"].max() for d in drv_data.values())
    t_global = np.arange(g_min, g_max, 1.0 / SAMPLE_HZ)

    positions: dict[str, dict] = {}
    for drv, d in drv_data.items():
        positions[drv] = {
            "x": _resample(d["t"], d["x"], t_global),
            "y": _resample(d["t"], d["y"], t_global),
        }

    # Circuit layout: random sample from all position points
    all_x_arr = np.array(all_x)
    all_y_arr = np.array(all_y)
    n_pts = min(12000, len(all_x_arr))
    rng = np.random.default_rng(42)
    idx = rng.choice(len(all_x_arr), n_pts, replace=False)

    result = {
        "sample_hz": SAMPLE_HZ,
        "t_start": round(float(g_min), 3),
        "t_end": round(float(g_max), 3),
        "n_frames": len(t_global),
        "positions": positions,
        "circuit": {
            "x": all_x_arr[idx].round(1).tolist(),
            "y": all_y_arr[idx].round(1).tolist(),
        },
    }
    cf.write_text(json.dumps(result))
    return result


def _load_laps(year: int, rnd: int, stype: str) -> dict:
    cf = DATA_DIR / f"{_key(year, rnd, stype)}_laps.json"
    if cf.exists():
        return json.loads(cf.read_text())

    session = fastf1.get_session(year, rnd, stype)
    session.load(telemetry=False, laps=True, messages=False)

    t_ref = _t_ref(session)
    laps = session.laps

    cols = ["DriverNumber", "LapNumber", "LapTime", "LapStartTime",
            "Position", "Sector1Time", "Sector2Time", "Sector3Time",
            "Compound", "TyreLife"]
    laps = laps[[c for c in cols if c in laps.columns]].copy()

    records = []
    for _, row in laps.iterrows():
        t_start = None
        if "LapStartTime" in row and not pd.isna(row["LapStartTime"]):
            try:
                t_start = round((row["LapStartTime"] - t_ref).total_seconds(), 2)
            except Exception:
                pass
        records.append({
            "driver": str(row["DriverNumber"]),
            "lap": int(row["LapNumber"]),
            "time": _td(row.get("LapTime")),
            "t_start": t_start,
            "position": int(row["Position"]) if "Position" in row and not pd.isna(row.get("Position")) else None,
            "s1": _td(row.get("Sector1Time")),
            "s2": _td(row.get("Sector2Time")),
            "s3": _td(row.get("Sector3Time")),
            "compound": str(row.get("Compound", "") or ""),
            "tyre_life": int(row["TyreLife"]) if "TyreLife" in row and not pd.isna(row.get("TyreLife")) else None,
        })

    result = {"laps": records}
    cf.write_text(json.dumps(result))
    return result


def _load_telemetry(year: int, rnd: int, stype: str, drv: str) -> dict:
    cf = DATA_DIR / f"{_key(year, rnd, stype)}_tel_{drv}.json"
    if cf.exists():
        return json.loads(cf.read_text())

    session = fastf1.get_session(year, rnd, stype)
    session.load(telemetry=True, laps=False, messages=False)

    if drv not in session.car_data or session.car_data[drv].empty:
        return {}

    t_ref = _t_ref(session)
    car = session.car_data[drv].copy()
    car["t"] = (car["Date"] - t_ref).dt.total_seconds()
    car = car[car["t"] >= 0].sort_values("t").drop_duplicates("t")

    t_v = car["t"].values
    t_out = np.arange(t_v.min(), t_v.max(), 1.0 / SAMPLE_HZ)

    field_map = {
        "Speed": "speed", "Throttle": "throttle", "Brake": "brake",
        "DRS": "drs", "nGear": "gear", "RPM": "rpm",
    }
    result: dict = {"t_start": round(float(t_v.min()), 3)}
    for src, dst in field_map.items():
        if src in car.columns:
            v = car[src].values.astype(float)
            result[dst] = _resample(t_v, v, t_out)
        else:
            result[dst] = []

    cf.write_text(json.dumps(result))
    return result


# ── endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/schedule/{year}")
async def get_schedule(year: int):
    try:
        return await run_in_threadpool(_load_schedule, year)
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/session/{year}/{rnd}/{stype}")
async def get_session(year: int, rnd: int, stype: str):
    try:
        return await run_in_threadpool(_load_info, year, rnd, stype)
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/positions/{year}/{rnd}/{stype}")
async def get_positions(year: int, rnd: int, stype: str):
    try:
        data = await run_in_threadpool(_load_positions, year, rnd, stype)
        return JSONResponse(data)
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/laps/{year}/{rnd}/{stype}")
async def get_laps(year: int, rnd: int, stype: str):
    try:
        return await run_in_threadpool(_load_laps, year, rnd, stype)
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/telemetry/{year}/{rnd}/{stype}/{drv}")
async def get_telemetry(year: int, rnd: int, stype: str, drv: str):
    try:
        return await run_in_threadpool(_load_telemetry, year, rnd, stype, drv)
    except Exception as e:
        raise HTTPException(500, str(e))


# Serve the frontend
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, timeout_keep_alive=600)
