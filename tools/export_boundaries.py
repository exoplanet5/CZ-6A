#!/usr/bin/env python3
"""Simplify pinned Natural Earth line datasets for the local globe overlay."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

from shapely import line_merge
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
REVISION = "ca96624a56bd078437bca8184e78163e5039ad19"
SOURCES = {
    "countries": ("ne_50m_admin_0_boundary_lines_land.geojson", "2faac4f6b34386f3d21b6e018cf151f241f00e5c936d44dd17d7d9bfb147fa48"),
    "regions": ("ne_10m_admin_1_states_provinces_lines.geojson", "1a1f30ccaaf4cc9c4bde34266f0b8cbb955d3a4cf254b756912255f2ec7c75b6"),
}


def line_parts(geometry):
    if geometry.geom_type == "LineString":
        yield geometry
    elif hasattr(geometry, "geoms"):
        for child in geometry.geoms:
            yield from line_parts(child)


def export(countries_path, regions_path):
    layers = {"countries": [], "disputed": [], "regions": []}
    counts = Counter()
    skipped = Counter()
    sources = {}
    for key, path in [("countries", countries_path), ("regions", regions_path)]:
        raw = path.read_bytes()
        filename, digest = SOURCES[key]
        if hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError(f"Source hash mismatch for {key}")
        source = json.loads(raw)
        if source.get("type") != "FeatureCollection":
            raise ValueError(f"Expected GeoJSON FeatureCollection for {key}")
        sources[key] = {
            "url": f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{REVISION}/geojson/{filename}",
            "sha256": digest,
        }
        for feature in source["features"]:
            if not feature.get("geometry"):
                skipped[key] += 1
                continue
            properties = feature["properties"]
            target = key
            if key == "countries" and properties["FEATURECLA"] != "International boundary (verify)":
                target = "disputed"
            geometry = line_merge(shape(feature["geometry"]))
            emitted = 0
            for part in line_parts(geometry):
                # Never simplify a wrap-spanning segment in planar longitude space.
                coords = list(part.coords)
                if any(abs(a[0] - b[0]) > 180 for a, b in zip(coords, coords[1:])):
                    raise ValueError("Source line crosses the antimeridian without a split")
                simplified = part.simplify(0.02, preserve_topology=True)
                rounded = []
                for lon, lat, *_ in simplified.coords:
                    point = [round(lon, 4), round(lat, 4)]
                    if not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90):
                        raise ValueError("Invalid geographic coordinate")
                    if not rounded or point != rounded[-1]:
                        rounded.append(point)
                if len(rounded) >= 2:
                    layers[target].append(rounded)
                    emitted += 1
            if not emitted:
                skipped[key] += 1
            elif key == "regions":
                counts[properties.get("ADM0_A3") or "unassigned"] += emitted
    if counts["CHN"] < 50 or len(counts) < 150 or not all(layers.values()):
        raise ValueError("Incomplete global or China regional coverage")
    return {
        "schema_version": 1,
        "source": {
            "name": "Natural Earth",
            "revision": REVISION,
            "license": "Public domain",
            "license_url": "https://www.naturalearthdata.com/about/terms-of-use/",
            "files": sources,
            "processing": "Merge connected parts per feature; simplify at 0.02 degrees; round to 4 decimal places; discard empty/zero-length lines.",
            "boundary_note": "Source classifications retained: international land borders are solid; disputed, indefinite and control lines are dashed. Generalized cartographic reference, not an authoritative statement of sovereignty.",
        },
        "coverage": {
            "region_line_counts": dict(sorted(counts.items())),
            "skipped_empty_features": dict(sorted(skipped.items())),
            "line_counts": {key: len(lines) for key, lines in layers.items()},
            "point_counts": {key: sum(len(line) for line in lines) for key, lines in layers.items()},
        },
        "layers": layers,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--countries", type=Path, required=True)
    parser.add_argument("--regions", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "docs/data/boundaries.json")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = export(args.countries, args.regions)
    text = json.dumps(data, separators=(",", ":"), allow_nan=False) + "\n"
    if args.check:
        if args.output.read_text() != text:
            raise ValueError("Boundary export is not reproducible")
    else:
        args.output.write_text(text)
    print(json.dumps({"bytes": len(text), "regional_administrations": len(data["coverage"]["region_line_counts"]), **data["coverage"]}, indent=2))


if __name__ == "__main__":
    main()
