"""Small geodesy helpers shared by the pipeline.

All matching/smoothing happens in a local East-North (meters) plane using an
equirectangular projection around a reference latitude — plenty accurate for
a drive that spans a few km.
"""

import math

EARTH_RADIUS_M = 6_371_000.0


class LocalPlane:
    """Equirectangular lat/lon <-> local EN meters converter."""

    def __init__(self, lat0: float, lon0: float):
        self.lat0 = lat0
        self.lon0 = lon0
        self._m_per_deg_lat = math.pi / 180.0 * EARTH_RADIUS_M
        self._m_per_deg_lon = self._m_per_deg_lat * math.cos(math.radians(lat0))

    def to_xy(self, lat: float, lon: float) -> tuple[float, float]:
        return ((lon - self.lon0) * self._m_per_deg_lon,
                (lat - self.lat0) * self._m_per_deg_lat)

    def to_latlon(self, x: float, y: float) -> tuple[float, float]:
        return (self.lat0 + y / self._m_per_deg_lat,
                self.lon0 + x / self._m_per_deg_lon)


def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def project_point_to_segment(px, py, ax, ay, bx, by):
    """Project P onto segment AB. Returns (qx, qy, t, dist) with t in [0, 1]."""
    dx, dy = bx - ax, by - ay
    seg_len2 = dx * dx + dy * dy
    if seg_len2 <= 0.0:
        t = 0.0
    else:
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_len2))
    qx, qy = ax + t * dx, ay + t * dy
    return qx, qy, t, math.hypot(px - qx, py - qy)


def bearing_deg(dx: float, dy: float) -> float:
    """Compass bearing (0 = north, clockwise) of an East/North delta."""
    return math.degrees(math.atan2(dx, dy)) % 360.0
