# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this directory (`f1map/`).

This is a standalone FastAPI + vanilla-JS web app, independent from the multi-agent pipeline in the repo root — see the root `CLAUDE.md` for that project. Nothing here is shared with it.

## Commands

```bash
cd f1map
pip install -r requirements.txt

# Run directly
python server.py        # http://0.0.0.0:8000

# Run with LAN URL + QR code for phone access
python start.py [--port 8000] [--host 0.0.0.0]
```

No test suite exists for this app.

## Architecture

- `server.py` is a FastAPI backend that wraps the `fastf1` library (F1's official timing API). All FastF1 calls are blocking/sync, so every loader (`_load_schedule`, `_load_info`, `_load_positions`, `_load_laps`, `_load_telemetry`) runs inside `run_in_threadpool` from the async route handlers.
- Two separate caches exist and must not be confused:
  - `cache/` — FastF1's own raw HTTP/session cache (`fastf1.Cache.enable_cache`).
  - `data_cache/` — this app's processed JSON cache, one file per `(year, round, session_type[, driver])`. Each cached file embeds `"_v": CACHE_VERSION`; bump `CACHE_VERSION` in `server.py` whenever the shape of cached data changes — stale-version files are auto-deleted and recomputed on next request.
- `_load_info` determines the real driver lineup for a session from `session.laps["DriverNumber"]` (actual participants), falling back to `session.drivers` only if no lap data exists — this avoids showing retired/non-starting drivers.
- Position/telemetry data is resampled onto a uniform time axis at `SAMPLE_HZ` (4 Hz) via linear interpolation (`_resample`), so the frontend always receives evenly spaced frames regardless of FastF1's native sampling.
- Errors distinguish "data not available" (`ValueError` → HTTP 404, with a Japanese message suggesting 2023/2024 data) from unexpected failures (→ HTTP 500).
- The frontend (`static/index.html`, `static/app.js`, `static/style.css`) is plain JS/CSS served directly via `StaticFiles` — no build step.
- `start.py` is a convenience launcher that detects the LAN IP, prints a QR code (via `qrcode` if installed), and otherwise imports and runs the same `server:app`.
