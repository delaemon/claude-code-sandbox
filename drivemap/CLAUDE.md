# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this directory (`drivemap/`).

This is a standalone FastAPI + vanilla-JS web app, independent from the multi-agent pipeline in the repo root and from `f1map/`. Nothing here is shared with them.

## Commands

```bash
cd drivemap
pip install -r requirements.txt

python server.py                       # viewer at http://0.0.0.0:8001

# Regenerate the synthetic demo by hand
python -m pipeline.synth data/synth
python -m pipeline.run --input data/synth/drive.csv \
    --roads data/synth/roads.geojson --name demo

# Process a real log (Torque Pro style combined CSV)
python -m pipeline.run --input drive.csv --fetch-roads --name myrun
```

No test suite exists. The synthetic demo is the de-facto integration test: `python -m pipeline.run --input data/synth/drive.csv --roads data/synth/roads.geojson --name demo` must complete with `matched=True` and 0 unmatched fixes.

## Architecture

Two halves connected only by run-bundle JSON files in `runs/`:

**Pipeline (Python, offline)** — `pipeline/run.py` is the CLI entry point.
- `merge.py` ingests logs. Column names and units are detected fuzzily from CSV headers (`_COLUMN_PATTERNS`), so Torque Pro / OBDLink app / Car Scanner exports all load; units are normalized at parse time (speed→km/h, boost→kPa). Every OBD channel keeps its **own time axis** (`Channel`) because loggers drop cells; GPS fixes are deduplicated because combined logs repeat the last fix on every high-rate OBD row.
- `mapmatch.py` implements Newson-Krumm HMM matching: candidates from a grid-indexed segment list, emission = projection distance, transition = |on-network dist − great-circle dist|, Viterbi per contiguous stretch of fixes that have candidates. On-network distances use a `networkx` graph whose nodes are way vertices snapped to 0.5 m (`node_of`), with an `lru_cache`d Dijkstra. After matching, `make_smoothing_spline` (lam=0.05, tuned for ~1 Hz GPS) yields continuous position + heading; heading is held below 0.6 m/s so it doesn't spin while stopped.
- `roads.py` fetches drivable OSM ways from Overpass into the GeoJSON that matching consumes — the only network-dependent step, always optional (`--roads` file instead).
- `synth.py` generates the offline demo: fake Shibuya street grid + a 2-lap drive with a gear model, written as a **Torque-format CSV** so the primary ingest path is exercised end to end.

**Viewer (FastAPI + vanilla JS, no build step)**
- `server.py` serves `static/` and run bundles; on startup it generates the demo run if `runs/` is empty (skip with `DRIVEMAP_NO_DEMO=1`). Run names are validated against `_NAME_RE` before touching the filesystem.
- `static/app.js` drives Cesium **without an ion token**: OSM imagery, ellipsoid globe. PLATEAU tilesets (from `config/plateau.json`, lazy-loaded per checkbox) are shifted down by `defaultHeightOffsetM` (~37 m Tokyo geoid height) to sit correctly on the ellipsoid — if buildings float or sink, adjust that value, don't touch positions in the pipeline.
- Playback is a manual `requestAnimationFrame` loop interpolating uniform-rate frames (`frameAt`), *not* Cesium's clock — this keeps HUD, scrub bar, and entity position sampled from the identical playhead. Camera modes: chase/overhead use `camera.lookAt` (locked transform), onboard/free must release it via `lookAtTransform(IDENTITY)` first.
- `static/hud.js` is a dependency-free canvas HUD; text always uses neutral ink colors, red is reserved for the redline state.

## Conventions

- Run bundles are the contract between the halves: uniform-rate parallel arrays under `frames`, rate in `hz`. If you change the shape, update both `pipeline/run.py` and `frameAt`/`loadRun` in `app.js`.
- PLATEAU tileset URLs in `config/plateau.json` rot (MLIT refreshes yearly); fix them there, source: https://www.geospatial.jp/ckan/dataset/plateau
- Port 8001 (f1map uses 8000).
