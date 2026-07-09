# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this directory (`hanedamap/`).

This is a standalone FastAPI + vanilla-JS web app, independent from the multi-agent pipeline in the repo root and from `f1map/`. Nothing here is shared with them.

## Commands

```bash
cd hanedamap
pip install -r requirements.txt

python server.py                      # http://0.0.0.0:8010 (PORT env to change)
HANEDAMAP_MOCK=1 python server.py     # simulated traffic, no upstream network needed
GOOGLE_MAPS_API_KEY=... python server.py  # serve the Maps key to the frontend
```

No test suite exists for this app.

## Architecture

- `server.py` proxies public ADS-B aggregator APIs (adsb.lol → adsb.fi → airplanes.live, tried in order with sticky failover) for aircraft within 100 km of Haneda (35.5494, 139.7798). Upstream radius is 54 nm; results are re-filtered to exactly 100 km with haversine in `normalize()`.
- **Shared 1-second cache**: `/api/aircraft` refreshes the upstream snapshot at most once per `FETCH_TTL` (1 s) behind an asyncio lock, so N browser clients still cost one upstream request/second. Stale data is served up to `STALE_LIMIT` (30 s) with `stale: true`, then an empty list.
- `HANEDAMAP_MOCK=1` replaces upstream fetching with `mock_aircraft()` — deterministic simulated flights whose positions are a pure function of wall-clock time (so consecutive polls show movement). Used for offline dev; this sandbox's network policy blocks the real ADS-B hosts.
- Frontend (`static/`) is plain JS/CSS, no build step. `app.js` polls `/api/aircraft` every 1 s (self-rescheduling `setTimeout`, compensating for request duration), diffs markers by ICAO `hex`, and rotates a plane-shaped SVG symbol path by `track` (path points north so track degrees map directly to Marker `rotation`).
- Google Maps API key resolution order (frontend): `?key=` URL param → `localStorage["gmaps_api_key"]` → `GOOGLE_MAPS_API_KEY` served via `/api/config`. With no key, an instruction panel is shown instead of the map; `gm_authFailure` clears a bad stored key.
- Altitude → marker color is a sequential blue ramp (light = low, dark = high) with neutral gray for on-ground aircraft; bins are defined in `ALT_COLORS` in `app.js` and mirrored in the legend markup in `index.html` — change both together.
