from __future__ import annotations

"""Haneda Flight Radar – FastAPI backend.

Proxies public ADS-B aggregator APIs (adsb.lol / adsb.fi / airplanes.live)
for live aircraft positions within 100 km of Haneda Airport (HND / RJTT),
normalizes the readsb-style JSON, and serves the static frontend.

The upstream is queried at most once per second regardless of how many
browser clients are polling — all clients share one cached snapshot.
"""
import asyncio
import math
import os
import random
import time

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

# ── constants ────────────────────────────────────────────────────────────────

HND_LAT = 35.5494  # Haneda Airport (RJTT)
HND_LON = 139.7798
RADIUS_KM = 100.0
RADIUS_NM = 54  # 100 km ≈ 53.996 nm — upstream APIs take nautical miles
FETCH_TTL = 1.0  # seconds; one upstream request per second, shared by all clients
STALE_LIMIT = 30.0  # seconds; after this, stop serving the last good snapshot

# Tried in order; on failure the next one is used and becomes preferred.
PROVIDERS = [
    ("adsb.lol", "https://api.adsb.lol/v2/point/{lat}/{lon}/{nm}"),
    ("adsb.fi", "https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm}"),
    ("airplanes.live", "https://api.airplanes.live/v2/point/{lat}/{lon}/{nm}"),
]

MOCK = os.environ.get("HANEDAMAP_MOCK", "") not in ("", "0", "false")

app = FastAPI(title="Haneda Flight Radar")
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ── helpers ──────────────────────────────────────────────────────────────────


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def normalize(raw: dict) -> dict | None:
    """readsb-style aircraft dict → compact frontend dict, or None if unusable."""
    lat, lon = raw.get("lat"), raw.get("lon")
    if lat is None or lon is None:
        return None
    dist = haversine_km(HND_LAT, HND_LON, lat, lon)
    if dist > RADIUS_KM:
        return None
    alt = raw.get("alt_baro", raw.get("alt_geom"))
    ground = alt == "ground"
    alt_ft = 0 if ground else (alt if isinstance(alt, (int, float)) else None)
    gs_kt = raw.get("gs")
    return {
        "hex": raw.get("hex", ""),
        "callsign": (raw.get("flight") or "").strip(),
        "reg": raw.get("r", ""),
        "type": raw.get("t", ""),
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "ground": ground,
        "alt_m": None if alt_ft is None else round(alt_ft * 0.3048),
        "gs_kmh": None if gs_kt is None else round(gs_kt * 1.852),
        "track": raw.get("track", raw.get("true_heading")),
        "dist_km": round(dist, 1),
    }


# ── mock mode (HANEDAMAP_MOCK=1): simulated traffic for offline development ──

_MOCK_SEED = random.Random(20260709)
_MOCK_FLEET = []
for i in range(28):
    bearing = _MOCK_SEED.uniform(0, 360)
    _MOCK_FLEET.append({
        "hex": f"84{i:04x}",
        "callsign": f"{_MOCK_SEED.choice(['ANA', 'JAL', 'SKY', 'SFJ', 'ADO', 'JJP'])}{_MOCK_SEED.randint(10, 999)}",
        "reg": f"JA{_MOCK_SEED.randint(100, 999)}A",
        "type": _MOCK_SEED.choice(["B738", "A321", "B789", "A359", "B77W", "A320"]),
        "entry_deg": bearing,           # where it enters the circle
        "track": (bearing + 180 + _MOCK_SEED.uniform(-50, 50)) % 360,
        "speed_kt": _MOCK_SEED.uniform(160, 470),
        "alt_ft": _MOCK_SEED.choice([0, 1500, 3000, 8000, 14000, 24000, 36000]),
        "phase": _MOCK_SEED.uniform(0, 1500),
    })


def mock_aircraft() -> list[dict]:
    now = time.time()
    out = []
    for f in _MOCK_FLEET:
        # Straight crossing: enter at the rim, fly along `track`, loop.
        speed_kms = f["speed_kt"] * 1.852 / 3600
        travelled = ((now + f["phase"]) * speed_kms) % (RADIUS_KM * 1.7)
        e = math.radians(f["entry_deg"])
        lat0 = HND_LAT + (RADIUS_KM / 111.0) * math.cos(e)
        lon0 = HND_LON + (RADIUS_KM / (111.0 * math.cos(math.radians(HND_LAT)))) * math.sin(e)
        t = math.radians(f["track"])
        lat = lat0 + (travelled / 111.0) * math.cos(t)
        lon = lon0 + (travelled / (111.0 * math.cos(math.radians(HND_LAT)))) * math.sin(t)
        ac = normalize({
            "hex": f["hex"], "flight": f["callsign"], "r": f["reg"], "t": f["type"],
            "lat": lat, "lon": lon, "gs": f["speed_kt"], "track": f["track"],
            "alt_baro": "ground" if f["alt_ft"] == 0 else f["alt_ft"],
        })
        if ac:
            out.append(ac)
    return out


# ── shared 1-second cache over the upstream APIs ─────────────────────────────

_lock = asyncio.Lock()
_cache: dict = {"at": 0.0, "aircraft": [], "source": None, "error": None}
_provider_idx = 0
_client: httpx.AsyncClient | None = None


async def fetch_upstream() -> None:
    global _provider_idx, _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=5.0, headers={"User-Agent": "hanedamap/1.0"})
    last_err: Exception | None = None
    for attempt in range(len(PROVIDERS)):
        idx = (_provider_idx + attempt) % len(PROVIDERS)
        name, url = PROVIDERS[idx]
        try:
            resp = await _client.get(url.format(lat=HND_LAT, lon=HND_LON, nm=RADIUS_NM))
            resp.raise_for_status()
            raw = resp.json().get("ac") or []
            aircraft = [a for a in (normalize(r) for r in raw) if a]
            _provider_idx = idx  # stick with whichever provider worked
            _cache.update(at=time.time(), aircraft=aircraft, source=name, error=None)
            return
        except Exception as e:  # noqa: BLE001 — any provider failure → try next
            last_err = e
    _cache["error"] = f"{type(last_err).__name__}: {last_err}"


# ── routes ───────────────────────────────────────────────────────────────────


@app.get("/api/config")
async def config() -> JSONResponse:
    return JSONResponse({
        "googleMapsApiKey": os.environ.get("GOOGLE_MAPS_API_KEY", ""),
        "center": {"lat": HND_LAT, "lng": HND_LON},
        "radiusKm": RADIUS_KM,
        "mock": MOCK,
    })


@app.get("/api/aircraft")
async def aircraft() -> JSONResponse:
    if MOCK:
        return JSONResponse({
            "aircraft": mock_aircraft(), "source": "mock",
            "fetched_at": round(time.time() * 1000), "stale": False, "error": None,
        })
    async with _lock:
        if time.time() - _cache["at"] >= FETCH_TTL:
            await fetch_upstream()
    age = time.time() - _cache["at"]
    stale = age > FETCH_TTL * 3
    expired = age > STALE_LIMIT
    return JSONResponse({
        "aircraft": [] if expired else _cache["aircraft"],
        "source": _cache["source"],
        "fetched_at": round(_cache["at"] * 1000) or None,
        "stale": stale,
        "error": _cache["error"] if stale else None,
    })


app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8010")))
