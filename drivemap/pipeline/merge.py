"""Ingest GPS / OBD2 logs and align them onto one uniform timeline.

Primary supported format is a Torque Pro style combined CSV (GPS and OBD
columns in one file, e.g. logged with an OBDLink MX+). Column names and units
are detected fuzzily from the header, so OBDLink app / Car Scanner exports
with different wording usually work too. A separate GPS track can also be
supplied as CSV or GPX.

Units are normalized to: speed km/h, boost kPa (relative), throttle %.
"""

import csv
import math
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import numpy as np

# ---------------------------------------------------------------- columns

# channel -> list of header regexes, first match wins (checked in order)
_COLUMN_PATTERNS: dict[str, list[str]] = {
    "time": [r"^device\s*time", r"^gps\s*time", r"^time\s*stamp", r"^timestamp",
             r"^date.?time", r"^time\b", r"^seconds\b", r"^sec\b"],
    "lat": [r"^lat(itude)?\b"],
    "lon": [r"^lon(gitude)?\b", r"^lng\b"],
    "alt": [r"^alt(itude)?\b", r"gps\s*height"],
    "speed": [r"speed\s*\(obd\)", r"vehicle\s*speed", r"^speed\b", r"gps\s*speed"],
    "rpm": [r"engine\s*rpm", r"engine\s*speed", r"^rpm\b"],
    "boost": [r"boost", r"manifold"],
    "throttle": [r"throttle"],
}

_UNIT_RE = re.compile(r"\(([^()]*)\)\s*$")


def _find_columns(header: list[str]) -> dict[str, int]:
    cols: dict[str, int] = {}
    for channel, patterns in _COLUMN_PATTERNS.items():
        for pat in patterns:
            rx = re.compile(pat, re.IGNORECASE)
            hit = next((i for i, h in enumerate(header) if rx.search(h.strip())), None)
            if hit is not None:
                cols[channel] = hit
                break
    return cols


def _unit_of(header_cell: str) -> str:
    m = _UNIT_RE.search(header_cell.strip())
    return m.group(1).strip().lower() if m else ""


def _speed_to_kmh(value: float, unit: str) -> float:
    if "mph" in unit:
        return value * 1.609344
    if unit in ("m/s", "mps") or "meters/s" in unit:
        return value * 3.6
    return value  # km/h or unlabeled


def _boost_to_kpa(value: float, unit: str) -> float:
    if "psi" in unit:
        return value * 6.894757
    if "bar" in unit:
        return value * 100.0
    return value  # kPa or unlabeled


# ---------------------------------------------------------------- time

_TIME_FORMATS = [
    "%d-%b-%Y %H:%M:%S.%f",  # Torque "Device Time": 04-Jul-2026 13:13:01.123
    "%d-%b-%Y %H:%M:%S",
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%d %H:%M:%S",
    "%Y/%m/%d %H:%M:%S.%f",
    "%Y/%m/%d %H:%M:%S",
]


def parse_time(raw: str) -> float | None:
    """Parse a timestamp cell to unix-ish seconds.

    Numeric cells are epoch seconds (>= 1e9), epoch milliseconds (>= 1e12),
    or otherwise relative seconds since log start — relative bases only line
    up across files if both logs share one, which combined CSVs always do.
    """
    raw = raw.strip()
    if not raw or raw == "-":
        return None
    try:
        v = float(raw)
        if v >= 1e12:
            return v / 1000.0
        return v
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(raw).timestamp()
    except ValueError:
        pass
    for fmt in _TIME_FORMATS:
        try:
            return datetime.strptime(raw, fmt).replace(
                tzinfo=timezone.utc).timestamp()
        except ValueError:
            continue
    return None


def _parse_float(raw: str) -> float | None:
    raw = raw.strip()
    if not raw or raw in ("-", "NaN", "nan", "null"):
        return None
    try:
        v = float(raw)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


# ---------------------------------------------------------------- readers

def _read_rows(path: str) -> tuple[list[str], list[list[str]]]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        sample = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        reader = csv.reader(f, dialect)
        rows = [r for r in reader if any(c.strip() for c in r)]
    if not rows:
        raise ValueError(f"{path}: empty file")
    return [c.strip() for c in rows[0]], rows[1:]


class Channel:
    """One measured quantity with its own time axis (logs drop cells, so
    every channel keeps independent timestamps)."""

    def __init__(self):
        self.t: list[float] = []
        self.v: list[float] = []

    def add(self, t: float, v: float):
        self.t.append(t)
        self.v.append(v)

    def __len__(self):
        return len(self.t)


class GpsTrack:
    def __init__(self):
        self.t: list[float] = []
        self.lat: list[float] = []
        self.lon: list[float] = []
        self.alt: list[float] = []

    def add(self, t: float, lat: float, lon: float, alt: float):
        self.t.append(t)
        self.lat.append(lat)
        self.lon.append(lon)
        self.alt.append(alt)

    def __len__(self):
        return len(self.t)


def load_table(path: str) -> tuple[GpsTrack, dict[str, Channel]]:
    """Load a CSV and split it into (gps, obd channels).

    Works for combined logs (Torque-style) and for single-purpose files —
    an OBD-only CSV just yields an empty GPS track and vice versa.
    """
    header, rows = _read_rows(path)
    cols = _find_columns(header)
    if "time" not in cols:
        raise ValueError(
            f"{path}: no time column found (header: {header[:8]}...)")

    units = {ch: _unit_of(header[i]) for ch, i in cols.items()}
    gps = GpsTrack()
    obd: dict[str, Channel] = {}
    last_fix: tuple[float, float] | None = None

    def cell(row: list[str], ch: str) -> str | None:
        i = cols.get(ch)
        return row[i] if i is not None and i < len(row) else None

    for row in rows:
        t = parse_time(cell(row, "time") or "")
        if t is None:
            continue

        lat = _parse_float(cell(row, "lat") or "")
        lon = _parse_float(cell(row, "lon") or "")
        if lat is not None and lon is not None and (lat, lon) != (0.0, 0.0):
            # combined logs repeat the last fix on every OBD row; only keep
            # rows where the fix actually moved so GPS keeps its native rate
            if (lat, lon) != last_fix:
                alt = _parse_float(cell(row, "alt") or "")
                gps.add(t, lat, lon, alt if alt is not None else 0.0)
                last_fix = (lat, lon)

        for ch, key in (("speed", "speed_kmh"), ("rpm", "rpm"),
                        ("boost", "boost_kpa"), ("throttle", "throttle_pct")):
            v = _parse_float(cell(row, ch) or "")
            if v is None:
                continue
            if ch == "speed":
                v = _speed_to_kmh(v, units.get(ch, ""))
            elif ch == "boost":
                v = _boost_to_kpa(v, units.get(ch, ""))
            obd.setdefault(key, Channel()).add(t, v)

    return gps, obd


def load_gpx(path: str) -> GpsTrack:
    root = ET.parse(path).getroot()

    def local(tag):  # strip xml namespace
        return tag.rsplit("}", 1)[-1]

    gps = GpsTrack()
    for el in root.iter():
        if local(el.tag) != "trkpt":
            continue
        t_raw = ele_raw = None
        for child in el:
            if local(child.tag) == "time":
                t_raw = child.text
            elif local(child.tag) == "ele":
                ele_raw = child.text
        if not t_raw:
            continue
        t = parse_time(t_raw.replace("Z", "+00:00"))
        if t is None:
            continue
        gps.add(t, float(el.attrib["lat"]), float(el.attrib["lon"]),
                float(ele_raw) if ele_raw else 0.0)
    return gps


def load_gps(path: str) -> GpsTrack:
    if path.lower().endswith(".gpx"):
        return load_gpx(path)
    gps, _ = load_table(path)
    return gps


# ---------------------------------------------------------------- timeline

def build_timeline(gps: GpsTrack, obd: dict[str, Channel],
                   hz: float) -> np.ndarray:
    """Uniform timestamps over the window all sources cover."""
    if not len(gps):
        raise ValueError("no GPS fixes found in input")
    starts = [min(gps.t)] + [min(c.t) for c in obd.values() if len(c)]
    ends = [max(gps.t)] + [max(c.t) for c in obd.values() if len(c)]
    t0, t1 = max(starts), min(ends)
    if t1 - t0 < 5.0:
        raise ValueError(
            f"GPS and OBD logs overlap for only {t1 - t0:.1f}s — "
            "check that both use the same time base")
    n = int((t1 - t0) * hz) + 1
    return t0 + np.arange(n) / hz


def resample_obd(obd: dict[str, Channel],
                 timeline: np.ndarray) -> dict[str, np.ndarray]:
    """Linear-interpolate each OBD channel onto the timeline (OBD is the
    high-rate source, so linear interp between real samples is enough)."""
    out: dict[str, np.ndarray] = {}
    for name, chan in obd.items():
        if len(chan) < 2:
            continue
        t = np.asarray(chan.t)
        v = np.asarray(chan.v, dtype=float)
        order = np.argsort(t)
        out[name] = np.interp(timeline, t[order], v[order])
    return out
