"""CLI: turn raw logs into a replay bundle the viewer can play.

    python -m pipeline.run --input drive.csv --roads roads.geojson \\
        --name myrun [--hz 10] [--out runs]

Input is either one combined CSV (--input, Torque Pro style) or separate
--gps (CSV/GPX) + --obd (CSV) files. --fetch-roads pulls the road network
around the track from Overpass when no --roads file is given (needs
internet); --no-match skips map matching entirely.

Output: runs/<name>.json with uniform-rate frames:
    { name, hz, t0, duration_s, center, meta,
      frames: { lat[], lon[], alt[], heading[], speed_kmh[], rpm[],
                boost_kpa[], throttle_pct[] } }
"""

import argparse
import json
import os
import sys

import numpy as np

from . import mapmatch, merge, roads
from .geo import LocalPlane


def build_run(gps: merge.GpsTrack, obd: dict, name: str, hz: float,
              roads_path: str | None, no_match: bool) -> dict:
    timeline = merge.build_timeline(gps, obd, hz)
    obd_frames = merge.resample_obd(obd, timeline)

    plane = LocalPlane(float(np.mean(gps.lat)), float(np.mean(gps.lon)))
    meta = {"matched": False, "n_gps_fixes": len(gps)}

    if roads_path and not no_match:
        network = mapmatch.RoadNetwork(mapmatch.load_roads(roads_path), plane)
        mx, my, n_unmatched = mapmatch.match(gps.t, gps.lat, gps.lon, network)
        meta.update(matched=True, n_unmatched_fixes=n_unmatched)
    else:
        xy = np.array([plane.to_xy(la, lo)
                       for la, lo in zip(gps.lat, gps.lon)])
        mx, my = xy[:, 0], xy[:, 1]

    lat, lon, alt, heading = mapmatch.smooth_track(
        gps.t, mx, my, timeline, plane, gps.alt)

    frames = {
        "lat": np.round(lat, 7).tolist(),
        "lon": np.round(lon, 7).tolist(),
        "alt": np.round(alt, 1).tolist(),
        "heading": np.round(heading, 1).tolist(),
    }
    for key in ("speed_kmh", "rpm", "boost_kpa", "throttle_pct"):
        if key in obd_frames:
            frames[key] = np.round(obd_frames[key], 2).tolist()

    return {
        "name": name,
        "hz": hz,
        "t0": float(timeline[0]),
        "duration_s": float(timeline[-1] - timeline[0]),
        "center": [float(np.mean(lat)), float(np.mean(lon))],
        "meta": meta,
        "frames": frames,
    }


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--input", help="combined GPS+OBD CSV (Torque Pro style)")
    p.add_argument("--gps", help="separate GPS track (CSV or GPX)")
    p.add_argument("--obd", help="separate OBD CSV")
    p.add_argument("--roads", help="road network GeoJSON for map matching")
    p.add_argument("--fetch-roads", action="store_true",
                   help="fetch roads around the track from Overpass")
    p.add_argument("--no-match", action="store_true",
                   help="skip map matching (spline over raw GPS only)")
    p.add_argument("--hz", type=float, default=10.0,
                   help="output frame rate (default 10)")
    p.add_argument("--name", help="run name (default: input filename)")
    p.add_argument("--out", default="runs", help="output directory")
    args = p.parse_args(argv)

    if not args.input and not args.gps:
        p.error("give --input (combined CSV) or --gps [+ --obd]")

    if args.input:
        gps, obd = merge.load_table(args.input)
        source = args.input
    else:
        gps = merge.load_gps(args.gps)
        obd = merge.load_table(args.obd)[1] if args.obd else {}
        source = args.gps

    if not len(gps):
        sys.exit(f"error: no GPS fixes found in {source}")

    roads_path = args.roads
    if roads_path is None and args.fetch_roads:
        os.makedirs(args.out, exist_ok=True)
        bbox = roads.bbox_of_track(gps.lat, gps.lon)
        roads_path = os.path.join(args.out, "_roads_fetched.geojson")
        print(f"fetching roads for bbox {bbox} ...", file=sys.stderr)
        roads.fetch_roads(*bbox, roads_path)

    name = args.name or os.path.splitext(os.path.basename(source))[0]
    run = build_run(gps, obd, name, args.hz, roads_path, args.no_match)
    run["meta"]["source"] = os.path.basename(source)

    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, f"{name}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(run, f)

    m = run["meta"]
    print(f"wrote {out_path}: {run['duration_s']:.0f}s @ {run['hz']:g}Hz, "
          f"{m['n_gps_fixes']} fixes, matched={m['matched']}"
          + (f" (unmatched: {m.get('n_unmatched_fixes', 0)})"
             if m["matched"] else ""))


if __name__ == "__main__":
    main()
