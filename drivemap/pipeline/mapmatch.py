"""Snap noisy GPS fixes onto the OSM road network, then smooth.

HMM map matching in the spirit of Newson & Krumm (2009):
  emission  — how far a candidate road projection is from the raw fix
  transition — how much the on-network distance between consecutive
               candidates disagrees with the great-circle distance the car
               actually covered
Viterbi picks the most plausible road-constrained path; a smoothing spline
over the matched points then yields a continuous position/heading function
that the viewer can sample at any rate.

The road network comes from a GeoJSON of LineString features (see roads.py
for fetching one from Overpass, or pipeline/synth.py which generates one).
"""

import json
import math
from functools import lru_cache

import networkx as nx
import numpy as np
from scipy.interpolate import CubicSpline, make_smoothing_spline

from .geo import LocalPlane, bearing_deg, project_point_to_segment

# Newson & Krumm suggest sigma ~= 4.07 m for consumer GPS
EMISSION_SIGMA_M = 4.5
TRANSITION_BETA_M = 20.0
CANDIDATE_RADIUS_M = 35.0
MAX_CANDIDATES = 6
GRID_CELL_M = 60.0


def load_roads(path: str) -> list[list[tuple[float, float]]]:
    """GeoJSON -> list of ways, each a list of (lat, lon) vertices."""
    with open(path, encoding="utf-8") as f:
        gj = json.load(f)
    ways = []
    for feat in gj.get("features", []):
        geom = feat.get("geometry") or {}
        if geom.get("type") == "LineString":
            coords = geom["coordinates"]
            if len(coords) >= 2:
                ways.append([(c[1], c[0]) for c in coords])
        elif geom.get("type") == "MultiLineString":
            for line in geom["coordinates"]:
                if len(line) >= 2:
                    ways.append([(c[1], c[0]) for c in line])
    if not ways:
        raise ValueError(f"{path}: no LineString features found")
    return ways


class RoadNetwork:
    """Road segments in local-plane meters plus a routing graph."""

    def __init__(self, ways: list[list[tuple[float, float]]],
                 plane: LocalPlane):
        self.plane = plane
        # segments: (ax, ay, bx, by, node_a, node_b, length)
        self.segments: list[tuple] = []
        self.graph = nx.Graph()
        self._grid: dict[tuple[int, int], list[int]] = {}
        node_ids: dict[tuple[int, int], int] = {}

        def node_of(x: float, y: float) -> int:
            # snap to 0.5 m so shared way endpoints become one graph node
            key = (round(x * 2), round(y * 2))
            if key not in node_ids:
                node_ids[key] = len(node_ids)
                self.graph.add_node(node_ids[key], x=x, y=y)
            return node_ids[key]

        for way in ways:
            xy = [plane.to_xy(lat, lon) for lat, lon in way]
            for (ax, ay), (bx, by) in zip(xy, xy[1:]):
                length = math.hypot(bx - ax, by - ay)
                if length < 0.01:
                    continue
                na, nb = node_of(ax, ay), node_of(bx, by)
                seg_id = len(self.segments)
                self.segments.append((ax, ay, bx, by, na, nb, length))
                w = self.graph.get_edge_data(na, nb)
                if w is None or w["weight"] > length:
                    self.graph.add_edge(na, nb, weight=length)
                for cell in self._cells_of_segment(ax, ay, bx, by):
                    self._grid.setdefault(cell, []).append(seg_id)

    @staticmethod
    def _cell(x: float, y: float) -> tuple[int, int]:
        return (int(x // GRID_CELL_M), int(y // GRID_CELL_M))

    def _cells_of_segment(self, ax, ay, bx, by):
        steps = max(1, int(math.hypot(bx - ax, by - ay) // GRID_CELL_M) + 1)
        return {self._cell(ax + (bx - ax) * i / steps,
                           ay + (by - ay) * i / steps)
                for i in range(steps + 1)}

    def candidates(self, x: float, y: float) -> list[dict]:
        """Road projections of (x, y) within CANDIDATE_RADIUS_M."""
        cx, cy = self._cell(x, y)
        reach = int(CANDIDATE_RADIUS_M // GRID_CELL_M) + 1
        seg_ids = set()
        for dx in range(-reach, reach + 1):
            for dy in range(-reach, reach + 1):
                seg_ids.update(self._grid.get((cx + dx, cy + dy), ()))
        cands = []
        for sid in seg_ids:
            ax, ay, bx, by, na, nb, length = self.segments[sid]
            qx, qy, t, dist = project_point_to_segment(x, y, ax, ay, bx, by)
            if dist <= CANDIDATE_RADIUS_M:
                cands.append({"seg": sid, "x": qx, "y": qy, "dist": dist,
                              "off_a": t * length, "off_b": (1 - t) * length,
                              "na": na, "nb": nb})
        cands.sort(key=lambda c: c["dist"])
        # keep the best projection per segment, then cap the fan-out
        best_per_seg: dict[int, dict] = {}
        for c in cands:
            best_per_seg.setdefault(c["seg"], c)
        return list(best_per_seg.values())[:MAX_CANDIDATES]

    @lru_cache(maxsize=200_000)
    def _node_dist(self, u: int, v: int) -> float:
        try:
            return nx.shortest_path_length(self.graph, u, v, weight="weight")
        except nx.NetworkXNoPath:
            return math.inf

    def route_distance(self, c1: dict, c2: dict) -> float:
        """On-network distance between two candidate projections."""
        if c1["seg"] == c2["seg"]:
            return abs(c1["off_a"] - c2["off_a"])
        node_dist = self._node_dist
        best = math.inf
        for end1, off1 in (("na", c1["off_a"]), ("nb", c1["off_b"])):
            for end2, off2 in (("na", c2["off_a"]), ("nb", c2["off_b"])):
                d = off1 + node_dist(c1[end1], c2[end2]) + off2
                best = min(best, d)
        return best


def match(gps_t: list[float], lats: list[float], lons: list[float],
          network: RoadNetwork) -> tuple[np.ndarray, np.ndarray, int]:
    """Viterbi-match raw fixes to the network.

    Returns (matched_x, matched_y, n_unmatched) in local-plane meters; fixes
    with no nearby road keep their raw position.
    """
    plane = network.plane
    xy_raw = np.array([plane.to_xy(la, lo) for la, lo in zip(lats, lons)])
    cand_lists = [network.candidates(x, y) for x, y in xy_raw]

    matched = xy_raw.copy()
    n_unmatched = sum(1 for c in cand_lists if not c)

    # Viterbi over contiguous stretches that have candidates
    i = 0
    n = len(gps_t)
    while i < n:
        if not cand_lists[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and cand_lists[j + 1]:
            j += 1
        _viterbi_stretch(gps_t, xy_raw, cand_lists, i, j, network, matched)
        i = j + 1
    return matched[:, 0], matched[:, 1], n_unmatched


def _viterbi_stretch(gps_t, xy_raw, cand_lists, i0, i1, network, matched):
    def emission(c):
        z = c["dist"] / EMISSION_SIGMA_M
        return -0.5 * z * z

    scores = [emission(c) for c in cand_lists[i0]]
    backptr: list[list[int]] = []

    for k in range(i0 + 1, i1 + 1):
        gc = float(np.hypot(*(xy_raw[k] - xy_raw[k - 1])))
        prev_cands, cur_cands = cand_lists[k - 1], cand_lists[k]
        new_scores, ptrs = [], []
        for c2 in cur_cands:
            best_s, best_p = -math.inf, 0
            for p, c1 in enumerate(prev_cands):
                route = network.route_distance(c1, c2)
                trans = (-abs(route - gc) / TRANSITION_BETA_M
                         if math.isfinite(route) else -50.0)
                s = scores[p] + trans
                if s > best_s:
                    best_s, best_p = s, p
            new_scores.append(best_s + emission(c2))
            ptrs.append(best_p)
        scores, _ = new_scores, backptr.append(ptrs)

    # backtrack
    idx = int(np.argmax(scores))
    for k in range(i1, i0 - 1, -1):
        c = cand_lists[k][idx]
        matched[k] = (c["x"], c["y"])
        if k > i0:
            idx = backptr[k - i0 - 1][idx]


def smooth_track(gps_t: list[float], mx: np.ndarray, my: np.ndarray,
                 timeline: np.ndarray, plane: LocalPlane,
                 alts: list[float] | None = None):
    """Smoothing spline through matched points, sampled on the timeline.

    Returns (lat, lon, alt, heading_deg) arrays aligned with `timeline`.
    """
    t = np.asarray(gps_t)
    order = np.argsort(t)
    t = t[order]
    # de-duplicate timestamps (spline needs strictly increasing x)
    keep = np.concatenate(([True], np.diff(t) > 1e-3))
    t, mx, my = t[keep], np.asarray(mx)[order][keep], np.asarray(my)[order][keep]

    tl = np.clip(timeline, t[0], t[-1])
    if len(t) >= 5:
        # lam tuned for ~1 Hz automotive GPS: strong enough to kill meter
        # scale jitter left after matching, weak enough to keep corners
        sx = make_smoothing_spline(t, mx, lam=0.05)
        sy = make_smoothing_spline(t, my, lam=0.05)
        x, y = sx(tl), sy(tl)
        dx, dy = sx.derivative()(tl), sy.derivative()(tl)
    else:
        cs_x, cs_y = CubicSpline(t, mx), CubicSpline(t, my)
        x, y = cs_x(tl), cs_y(tl)
        dx, dy = cs_x(tl, 1), cs_y(tl, 1)

    heading = np.array([bearing_deg(a, b) for a, b in zip(dx, dy)])
    # hold heading through stops instead of letting it spin on noise
    speed = np.hypot(dx, dy)
    for i in range(1, len(heading)):
        if speed[i] < 0.6:  # m/s
            heading[i] = heading[i - 1]

    latlon = np.array([plane.to_latlon(a, b) for a, b in zip(x, y)])

    if alts is not None and len(alts) == len(gps_t):
        alt = np.interp(tl, t, np.asarray(alts)[order][keep])
    else:
        alt = np.zeros_like(tl)
    return latlon[:, 0], latlon[:, 1], alt, heading
