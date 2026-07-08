"""Fetch a drivable road network from OpenStreetMap via Overpass.

Produces the GeoJSON of LineStrings that mapmatch.py consumes. Needs
internet access; when working offline pass a pre-downloaded file to the
pipeline instead (--roads).
"""

import json

import requests

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# highway classes a car can actually drive on
_DRIVABLE = ("motorway|trunk|primary|secondary|tertiary|unclassified|"
             "residential|motorway_link|trunk_link|primary_link|"
             "secondary_link|tertiary_link|living_street|service")


def fetch_roads(south: float, west: float, north: float, east: float,
                out_path: str, timeout_s: int = 90) -> str:
    query = f"""
[out:json][timeout:{timeout_s}];
way["highway"~"^({_DRIVABLE})$"]({south},{west},{north},{east});
out geom;
"""
    resp = requests.post(OVERPASS_URL, data={"data": query},
                         timeout=timeout_s + 30)
    resp.raise_for_status()
    elements = resp.json().get("elements", [])

    features = []
    for el in elements:
        geom = el.get("geometry")
        if not geom or len(geom) < 2:
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "osm_id": el.get("id"),
                "highway": el.get("tags", {}).get("highway"),
                "name": el.get("tags", {}).get("name"),
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [[p["lon"], p["lat"]] for p in geom],
            },
        })
    if not features:
        raise ValueError("Overpass returned no drivable ways for this bbox")

    gj = {"type": "FeatureCollection", "features": features}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False)
    return out_path


def bbox_of_track(lats, lons, margin_deg: float = 0.003):
    """Bounding box around a GPS track, padded ~300 m."""
    return (min(lats) - margin_deg, min(lons) - margin_deg,
            max(lats) + margin_deg, max(lons) + margin_deg)
