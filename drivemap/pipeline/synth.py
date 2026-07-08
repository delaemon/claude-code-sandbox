"""Generate a synthetic drive around Shibuya for offline development.

Emits three files into a directory:
  roads.geojson — a small fake street grid (so map matching runs offline)
  drive.csv     — Torque Pro style combined log: GPS fixes at 1 Hz with
                  gaussian noise, OBD channels at 10 Hz
The car drives two laps of a rectangular loop with plausible accel/brake
behavior; RPM comes from a 5-speed gear model, boost/throttle follow the
acceleration demand. Deterministic (seeded) so the demo run is stable.
"""

import csv
import json
import math
import os
from datetime import datetime, timezone

import numpy as np

from .geo import LocalPlane, bearing_deg

CENTER_LAT, CENTER_LON = 35.6580, 139.7016  # Shibuya
OBD_HZ = 10.0
GPS_HZ = 1.0
GPS_NOISE_M = 3.5

# rectangular loop in local meters (clockwise), rounded at corners by the
# speed profile rather than the geometry
LOOP = [(0, 0), (900, 0), (900, 550), (0, 550)]
GEAR_RATIOS = [3.6, 2.1, 1.45, 1.05, 0.82]
FINAL_DRIVE = 4.1
WHEEL_CIRC_M = 1.95
IDLE_RPM, REDLINE = 800.0, 6500.0


def _loop_points(closed=True):
    pts = LOOP + [LOOP[0]] if closed else LOOP
    return [(float(x), float(y)) for x, y in pts]


def _make_roads(plane: LocalPlane, path: str):
    """The drive loop plus a few decoy streets so matching isn't trivial."""
    lines_m = [_loop_points()]
    for x in (300, 600):  # north-south cross streets
        lines_m.append([(x, -80.0), (x, 630.0)])
    lines_m.append([(-80.0, 275.0), (980.0, 275.0)])  # east-west street
    lines_m.append([(-80.0, -60.0), (980.0, -60.0)])  # decoy parallel to leg 1

    features = []
    for line in lines_m:
        coords = []
        for x, y in line:
            lat, lon = plane.to_latlon(x, y)
            coords.append([lon, lat])
        features.append({
            "type": "Feature", "properties": {"highway": "residential"},
            "geometry": {"type": "LineString", "coordinates": coords},
        })
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)


def _drive_profile(laps: int, dt: float, rng: np.random.Generator):
    """Integrate motion along the loop -> arrays of (x, y, speed m/s)."""
    pts = _loop_points()
    seg_vecs = [(bx - ax, by - ay) for (ax, ay), (bx, by) in zip(pts, pts[1:])]
    seg_len = [math.hypot(dx, dy) for dx, dy in seg_vecs]
    total = sum(seg_len)

    def pos_at(s: float):
        s = s % total
        for (ax, ay), (dx, dy), L in zip(pts, seg_vecs, seg_len):
            if s <= L:
                return ax + dx * s / L, ay + dy * s / L
            s -= L
        return pts[-1]

    def target_speed(s: float):
        """Slow near corners, brisk on straights."""
        s = s % total
        acc = 0.0
        for L in seg_len:
            for corner in (acc, acc + L):
                if abs(s - corner) < 45.0 or abs(s - corner) > total - 45.0:
                    return 6.5  # ~23 km/h through corners
            acc += L
        return 15.5  # ~56 km/h on straights

    xs, ys, vs = [], [], []
    s, v = 0.0, 0.0
    while s < total * laps:
        vt = target_speed(s) + rng.normal(0, 0.3)
        if v < vt:
            v = min(vt, v + 2.5 * dt)   # accel limit
        else:
            v = max(vt, v - 3.5 * dt)   # braking limit
        s += v * dt
        x, y = pos_at(s)
        xs.append(x)
        ys.append(y)
        vs.append(v)
    return np.array(xs), np.array(ys), np.array(vs)


def _obd_from_speed(v_ms: np.ndarray, dt: float,
                    rng: np.random.Generator):
    accel = np.gradient(v_ms, dt)
    kmh = v_ms * 3.6

    rpm = np.full_like(v_ms, IDLE_RPM)
    gears = np.zeros(len(v_ms), dtype=int)
    gear = 0
    for i, v in enumerate(v_ms):
        wheel_rpm = (v / WHEEL_CIRC_M) * 60.0
        r = wheel_rpm * GEAR_RATIOS[gear] * FINAL_DRIVE
        # hysteresis shift points so gears don't chatter
        while r > 5200 and gear < len(GEAR_RATIOS) - 1:
            gear += 1
            r = wheel_rpm * GEAR_RATIOS[gear] * FINAL_DRIVE
        while r < 1400 and gear > 0:
            gear -= 1
            r = wheel_rpm * GEAR_RATIOS[gear] * FINAL_DRIVE
        rpm[i] = max(IDLE_RPM, min(REDLINE, r))
        gears[i] = gear

    throttle = np.clip(12 + accel * 28 + kmh * 0.25, 0, 100)
    throttle += rng.normal(0, 1.5, len(throttle))
    throttle = np.clip(throttle, 0, 100)

    boost = np.clip(-45 + throttle * 1.5 + accel * 8, -60, 120)
    boost += rng.normal(0, 2.0, len(boost))
    return kmh, rpm, np.clip(boost, -60, 130), throttle


def generate(out_dir: str, laps: int = 2, seed: int = 7) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    rng = np.random.default_rng(seed)
    plane = LocalPlane(CENTER_LAT, CENTER_LON)

    roads_path = os.path.join(out_dir, "roads.geojson")
    _make_roads(plane, roads_path)

    dt = 1.0 / OBD_HZ
    xs, ys, v_ms = _drive_profile(laps, dt, rng)
    kmh, rpm, boost_kpa, throttle = _obd_from_speed(v_ms, dt, rng)
    boost_psi = boost_kpa / 6.894757  # Torque logs boost in psi

    n = len(xs)
    t0 = datetime(2026, 7, 4, 13, 13, 0, tzinfo=timezone.utc).timestamp()
    times = t0 + np.arange(n) * dt

    # GPS: 1 Hz samples of the true path + white noise + slow bias walk
    gps_every = int(OBD_HZ / GPS_HZ)
    bias = np.cumsum(rng.normal(0, 0.15, (n, 2)), axis=0)
    bias -= bias.mean(axis=0)

    csv_path = os.path.join(out_dir, "drive.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Device Time", "Longitude", "Latitude", "Altitude",
                    "Bearing", "GPS Speed (Meters/second)",
                    "Speed (OBD)(km/h)", "Engine RPM(rpm)",
                    "Turbo Boost & Vacuum Gauge(psi)",
                    "Throttle Position(Manifold)(%)"])
        heading = 0.0
        for i in range(n):
            ts = datetime.fromtimestamp(times[i], tz=timezone.utc)
            stamp = ts.strftime("%d-%b-%Y %H:%M:%S.") + f"{ts.microsecond // 1000:03d}"
            if i % gps_every == 0:
                nx_, ny_ = rng.normal(0, GPS_NOISE_M, 2) + bias[i]
                lat, lon = plane.to_latlon(xs[i] + nx_, ys[i] + ny_)
                if i > 0:
                    heading = bearing_deg(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
                gps_cells = [f"{lon:.7f}", f"{lat:.7f}", "35.0",
                             f"{heading:.1f}", f"{v_ms[i]:.2f}"]
            else:
                gps_cells = ["-", "-", "-", "-", "-"]  # Torque pads gaps
            w.writerow([stamp, *gps_cells, f"{kmh[i]:.1f}", f"{rpm[i]:.0f}",
                        f"{boost_psi[i]:.2f}", f"{throttle[i]:.1f}"])

    return {"csv": csv_path, "roads": roads_path,
            "duration_s": n * dt, "center": (CENTER_LAT, CENTER_LON)}


if __name__ == "__main__":
    import sys
    info = generate(sys.argv[1] if len(sys.argv) > 1 else "data/synth")
    print(json.dumps(info, indent=2))
