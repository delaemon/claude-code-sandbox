"""FastAPI backend: serves the viewer and processed replay bundles.

Run bundles are whatever pipeline/run.py wrote into runs/. On first start
(empty runs/) a synthetic Shibuya demo is generated so the viewer works
before any real OBDLink log is imported. Set DRIVEMAP_NO_DEMO=1 to skip.
"""

import json
import os
import re

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RUNS_DIR = os.path.join(BASE_DIR, "runs")
CONFIG_DIR = os.path.join(BASE_DIR, "config")

_NAME_RE = re.compile(r"^[\w.-]+$")

app = FastAPI(title="drivemap")


def _ensure_demo():
    os.makedirs(RUNS_DIR, exist_ok=True)
    has_runs = any(f.endswith(".json") for f in os.listdir(RUNS_DIR))
    if has_runs or os.environ.get("DRIVEMAP_NO_DEMO"):
        return
    from pipeline import run as pipeline_run
    from pipeline import synth
    info = synth.generate(os.path.join(BASE_DIR, "data", "synth"))
    pipeline_run.main(["--input", info["csv"], "--roads", info["roads"],
                       "--name", "demo", "--out", RUNS_DIR])


@app.on_event("startup")
def startup():
    _ensure_demo()


@app.get("/api/runs")
def list_runs():
    runs = []
    for fname in sorted(os.listdir(RUNS_DIR)):
        if not fname.endswith(".json") or fname.startswith("_"):
            continue
        try:
            with open(os.path.join(RUNS_DIR, fname), encoding="utf-8") as f:
                r = json.load(f)
            runs.append({"name": r["name"], "duration_s": r["duration_s"],
                         "hz": r["hz"], "center": r["center"],
                         "meta": r.get("meta", {})})
        except (json.JSONDecodeError, KeyError):
            continue
    return runs


@app.get("/api/runs/{name}")
def get_run(name: str):
    if not _NAME_RE.match(name):
        raise HTTPException(400, "invalid run name")
    path = os.path.join(RUNS_DIR, f"{name}.json")
    if not os.path.isfile(path):
        raise HTTPException(404, f"run '{name}' not found")
    return FileResponse(path, media_type="application/json")


@app.get("/api/plateau")
def plateau_config():
    with open(os.path.join(CONFIG_DIR, "plateau.json"), encoding="utf-8") as f:
        return JSONResponse(json.load(f))


app.mount("/", StaticFiles(directory=os.path.join(BASE_DIR, "static"),
                           html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
