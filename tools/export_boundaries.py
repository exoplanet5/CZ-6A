#!/usr/bin/env python3
"""Export hash-pinned Natural Earth boundaries, with China-claims adaptive LODs.

The original two-input invocation remains available as a neutral, 50m single
export. China-claims exports require the 10m land, claim-line and disputed-area
sources together; omitting claim geometry must never silently change worldview.
Production exports retain worldwide country borders and China-only regional detail.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

from shapely import line_merge, union_all
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
REVISION = "ca96624a56bd078437bca8184e78163e5039ad19"
SOURCES = {
    "countries": ("ne_50m_admin_0_boundary_lines_land.geojson", "2faac4f6b34386f3d21b6e018cf151f241f00e5c936d44dd17d7d9bfb147fa48"),
    "countries10m": ("ne_10m_admin_0_boundary_lines_land.geojson", "74d9c16229c095fde65943a9919e337682f044bcebccb120764f38edf3b70f4a"),
    "claims": ("ne_10m_admin_0_boundary_lines_disputed_areas.geojson", "69f19da764e6982b43aebae4b1a356ffe74c33f2a3cdb462637c0ba8e969c30b"),
    "areas": ("ne_10m_admin_0_disputed_areas.geojson", "9cafef8b7dfb6b164dc58f218f981f4ace9f716f6c03795d4c62d1ac9f3d50f5"),
    "regions": ("ne_10m_admin_1_states_provinces_lines.geojson", "1a1f30ccaaf4cc9c4bde34266f0b8cbb955d3a4cf254b756912255f2ec7c75b6"),
}
LEVELS = (
    ("coarse", "boundaries.json", 0.10),
    ("medium", "boundaries-medium.json", 0.02),
    ("fine", "boundaries-fine.json", 0.0025),
)
MAX_FINE_POINTS = 350000
WORLDVIEW = "China claims"
CHINA_REGION_CODES = {"CHN", "HKG", "MAC", "TWN"}
INTERNATIONAL = "International boundary (verify)"
REGION_CLASSES = {
    "Map unit boundary", "Admin-1 boundary", "Admin-1 region boundary",
    "Admin-1 statistical boundary", "Admin-1 statistical meta bounds",
    "Admin-1 boundary indicator",
}
POLICY = (
    "Use nonempty FCLASS_CN, otherwise FEATURECLA; omit Unrecognized*; "
    "International boundary (verify) -> countries; Map unit/Admin-1 classes "
    "-> regions; every other class, including unknown values, -> disputed. "
    "Apply the same rule to land, auxiliary claim lines and regional lines. "
    "Remove regional line portions inside/on disputed-area polygons assigned "
    "to CHN by ADM0_A3_CN but not by ADM0_A3 (excluding polygons explicitly "
    "classified as Admin-1); do not draw polygon edges or invent provinces. "
    "Display regional lines only for China (source codes CHN/HKG/MAC/TWN "
    "in the selected China-claims view), including China-internal map-unit "
    "limits. Keep country and disputed/control lines worldwide unchanged."
)
NOTE = (
    "Natural Earth's sourced China-claims worldview, not an assertion that "
    "disputes are resolved or an authoritative/current statement of sovereignty. "
    "Arunachal Pradesh (also called South Tibet in the source) is administered "
    "by India and claimed by China. The sourced Chinese claim is shown as the "
    "outer boundary; the source's FCLASS_CN=Unrecognized de facto/McMahon "
    "sector is omitted, not relabeled as a province boundary. Other disputes "
    "retain source China-view classifications, falling back to default where "
    "no China override is supplied. Land boundaries only: no maritime claims "
    "or island/coastal sovereignty outlines are inferred from imagery."
)


def line_parts(geometry):
    if geometry.geom_type == "LineString":
        yield geometry
    elif hasattr(geometry, "geoms"):
        for child in geometry.geoms:
            yield from line_parts(child)


def read_source(key, path):
    raw = Path(path).read_bytes()
    filename, digest = SOURCES[key]
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError(f"Source hash mismatch for {key}")
    data = json.loads(raw)
    if data.get("type") != "FeatureCollection":
        raise ValueError(f"Expected GeoJSON FeatureCollection for {key}")
    return data, {
        "url": f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{REVISION}/geojson/{filename}",
        "sha256": digest,
    }


def classify(properties):
    """Never promote an unspecified/unknown class to an accepted boundary."""
    effective = properties.get("FCLASS_CN") or properties.get("FEATURECLA") or "Unknown"
    if effective.startswith("Unrecognized"):
        target = None
    elif effective == INTERNATIONAL:
        target = "countries"
    elif effective in REGION_CLASSES:
        target = "regions"
    else:
        target = "disputed"
    return effective, target


def region_owner(properties):
    """Resolve regional display scope from source identifiers, never a bbox."""
    administration = properties.get("ADM0_A3")
    if administration is not None:
        return administration if administration in CHINA_REGION_CODES else None
    # Hong Kong/Macau land limits are regional in the selected China view.
    sides = {properties.get("ADM0_A3_L"), properties.get("ADM0_A3_R")}
    if sides - {None} and sides - {None} <= CHINA_REGION_CODES:
        return "CHN" if "CHN" in sides else sorted(sides - {None})[0]
    return None


def rounded_line(part, tolerance):
    coords = list(part.coords)
    if any(abs(a[0] - b[0]) > 180 for a, b in zip(coords, coords[1:])):
        raise ValueError("Source line crosses the antimeridian without a split")
    rounded = []
    for lon, lat, *_ in part.simplify(tolerance, preserve_topology=True).coords:
        point = [round(lon, 4), round(lat, 4)]
        if not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90):
            raise ValueError("Invalid geographic coordinate")
        if not rounded or point != rounded[-1]:
            rounded.append(point)
    # Also reject a fully collapsed ring, not only consecutive duplicates.
    if len({tuple(p) for p in rounded}) >= 2:
        if any(abs(a[0] - b[0]) > 180 for a, b in zip(rounded, rounded[1:])):
            raise ValueError("Simplification introduced an antimeridian crossing")
        return rounded
    return None


def prepare_worldview(countries_path, regions_path, claims_path, areas_path):
    """Resolve worldview once, before simplification, identically for all LODs."""
    loaded, sources = {}, {}
    for key, path in [("countries10m", countries_path), ("claims", claims_path),
                      ("areas", areas_path), ("regions", regions_path)]:
        loaded[key], sources[key] = read_source(key, path)
    masks, mask_records = [], []
    for feature in loaded["areas"]["features"]:
        p = feature["properties"]
        if (p.get("ADM0_A3_CN") == "CHN" and p.get("ADM0_A3") != "CHN"
                and not (p.get("FCLASS_CN") or "").startswith("Admin-1")):
            polygon = shape(feature["geometry"])
            if not polygon.is_valid:
                raise ValueError("Invalid sourced China-claim polygon")
            masks.append(polygon)
            mask_records.append({"ne_id": p["NE_ID"], "brk_a3": p["BRK_A3"],
                                 "name": p["BRK_NAME"], "note": p.get("NOTE_BRK"),
                                 "administered_as": p["ADM0_A3"], "china_view": p["ADM0_A3_CN"]})
    if not any(record["brk_a3"] == "B00" for record in mask_records):
        raise ValueError("Missing sourced Arunachal Pradesh claim polygon")
    mask = union_all(masks)
    prepared, audit, clipped, skipped = [], [], [], Counter()
    filtered_regions = Counter()
    classifications = {key: Counter() for key in ["countries10m", "claims", "regions"]}
    for key in classifications:
        for feature in loaded[key]["features"]:
            p = feature["properties"]
            effective, target = classify(p)
            classifications[key][f"{effective} -> {target or 'omitted'}"] += 1
            record = {"source": key, "ne_id": p["ne_id"], "brk_a3": p.get("BRK_A3"),
                      "name": p.get("NAME"), "feature_class": p.get("FEATURECLA"),
                      "worldview_class": p.get("FCLASS_CN"), "layer": target}
            if p.get("FCLASS_CN"):
                audit.append(record)
            if target is None:
                continue
            owner = region_owner(p) if target == "regions" else None
            if target == "regions" and owner is None:
                sides = "/".join(filter(None, [p.get("ADM0_A3_L"), p.get("ADM0_A3_R")]))
                foreign_owner = p.get("ADM0_A3") or sides or "unassigned"
                filtered_regions[foreign_owner] += 1
                continue
            if not feature.get("geometry"):
                skipped[key] += 1
                continue
            geometry = line_merge(shape(feature["geometry"]))
            if key == "regions" and geometry.intersects(mask):
                # Difference removes existing linework only; it cannot generate
                # a fictitious provincial line along the claim polygon boundary.
                remaining = geometry.difference(mask)
                if geometry.length - remaining.length > 1e-10:
                    clipped.append({**record, "removed_degrees": round(geometry.length - remaining.length, 8)})
                geometry = remaining
            parts = list(line_parts(geometry))
            if not parts:
                skipped[key] += 1
            for part in parts:
                prepared.append((target, part, owner,
                                 key, p["ne_id"]))
    return prepared, sources, {
        "classification_counts": {key: dict(sorted(value.items())) for key, value in classifications.items()},
        "worldview_overrides": audit,
        "regional_claim_masks": mask_records,
        "clipped_region_features": clipped,
        "filtered_foreign_region_features": dict(sorted(filtered_regions.items())),
        "skipped_empty_features": dict(sorted(skipped.items())),
    }


def export_level(prepared, sources, audit, tolerance, level):
    if tolerance < 0:
        raise ValueError("Simplification tolerance must be nonnegative")
    layers = {"countries": [], "disputed": [], "regions": []}
    counts, claim_indices, region_owners = Counter(), [], []
    for target, part, administration, key, ne_id in prepared:
        line = rounded_line(part, tolerance)
        if line:
            if key == "claims" and ne_id == 1746705431:
                claim_indices.append(len(layers[target]))
            layers[target].append(line)
            if target == "regions":
                if administration not in CHINA_REGION_CODES:
                    raise ValueError("Regional line outside China display scope")
                counts[administration] += 1
                region_owners.append(administration)
    if counts["CHN"] < 50 or not set(counts) <= CHINA_REGION_CODES or not all(layers.values()) or not claim_indices:
        raise ValueError("Incomplete global, China regional or southern Tibet claim coverage")
    point_counts = {key: sum(map(len, lines)) for key, lines in layers.items()}
    if level == "fine" and sum(point_counts.values()) > MAX_FINE_POINTS:
        raise ValueError(f"Fine boundary export exceeds {MAX_FINE_POINTS} coordinate pairs")
    return {
        "schema_version": 1,
        "source": {
            "name": "Natural Earth", "revision": REVISION, "license": "Public domain",
            "license_url": "https://www.naturalearthdata.com/about/terms-of-use/",
            "worldview": WORLDVIEW, "boundary_note": NOTE,
            "regional_scope": "China only", "regional_scope_codes": sorted(CHINA_REGION_CODES),
            "worldview_policy_url": "https://www.naturalearthdata.com/about/disputed-boundaries-policy/",
            "claim_geometry_url": "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-breakaway-disputed-areas/",
            "classification_policy": POLICY, "files": sources,
            "level": level, "simplification_degrees": tolerance, "coordinate_decimals": 4,
            "processing": "Resolve China worldview, restrict regional display to China, merge connected parts per feature and clip regional lines before simplification; all LODs use the same pinned 1:10m sources. Round to four decimals and discard collapsed lines. No generated polygon edges.",
        },
        "coverage": {
            "region_line_counts": dict(sorted(counts.items())), "region_line_owners": region_owners, **audit,
            "southern_tibet": {"claim_ne_id": 1746705431, "claim_layer": "countries",
                               "claim_line_indices": claim_indices, "omitted_land_ne_id": 1746705337,
                               "claim_bbox": [92.03586, 26.852057, 97.036175, 28.262514]},
            "line_counts": {key: len(lines) for key, lines in layers.items()},
            "point_counts": point_counts, "total_points": sum(point_counts.values()),
        },
        "layers": layers,
    }


def export(countries_path, regions_path, *, claims_path=None, areas_path=None,
           tolerance=0.02, level="medium"):
    """Single-export API; the original 50m two-argument form remains neutral."""
    if claims_path is not None or areas_path is not None:
        if claims_path is None or areas_path is None:
            raise ValueError("China-claims export requires both --claims and --areas")
        return export_level(*prepare_worldview(countries_path, regions_path, claims_path, areas_path),
                            tolerance, level)
    layers = {"countries": [], "disputed": [], "regions": []}
    counts, skipped, sources = Counter(), Counter(), {}
    for key, path in [("countries", countries_path), ("regions", regions_path)]:
        source, sources[key] = read_source(key, path)
        for feature in source["features"]:
            if not feature.get("geometry"):
                skipped[key] += 1
                continue
            p = feature["properties"]
            target = "disputed" if key == "countries" and p["FEATURECLA"] != INTERNATIONAL else key
            emitted = 0
            for part in line_parts(line_merge(shape(feature["geometry"]))):
                line = rounded_line(part, tolerance)
                if line:
                    layers[target].append(line)
                    emitted += 1
            if not emitted:
                skipped[key] += 1
            elif key == "regions":
                counts[p.get("ADM0_A3") or "unassigned"] += emitted
    if counts["CHN"] < 50 or len(counts) < 150 or not all(layers.values()):
        raise ValueError("Incomplete global or China regional coverage")
    return {"schema_version": 1, "source": {
        "name": "Natural Earth", "revision": REVISION, "license": "Public domain",
        "license_url": "https://www.naturalearthdata.com/about/terms-of-use/", "files": sources,
        "worldview": "Natural Earth default (legacy)", "simplification_degrees": tolerance,
        "processing": "Legacy two-input export: merge per feature, simplify, round to four decimals.",
        "boundary_note": "Default source classifications retained; no China-claims override. Generalized reference, not an authoritative statement of sovereignty.",
    }, "coverage": {
        "region_line_counts": dict(sorted(counts.items())), "skipped_empty_features": dict(sorted(skipped.items())),
        "line_counts": {key: len(lines) for key, lines in layers.items()},
        "point_counts": {key: sum(map(len, lines)) for key, lines in layers.items()},
    }, "layers": layers}


def write_export(data, output, check):
    text = json.dumps(data, separators=(",", ":"), allow_nan=False) + "\n"
    if check:
        if output.read_text() != text:
            raise ValueError(f"Boundary export is not reproducible: {output}")
    else:
        output.write_text(text)
    print(json.dumps({"file": str(output), "bytes": len(text.encode()),
                      "level": data["source"].get("level", "legacy"),
                      "regional_administrations": len(data["coverage"]["region_line_counts"]),
                      "line_counts": data["coverage"]["line_counts"],
                      "point_counts": data["coverage"]["point_counts"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--countries", type=Path, required=True, help="Pinned 10m land source, or 50m for legacy two-input export")
    parser.add_argument("--regions", type=Path, required=True)
    parser.add_argument("--claims", type=Path, help="Pinned 10m auxiliary disputed/claim lines")
    parser.add_argument("--areas", type=Path, help="Pinned 10m disputed-area polygons (regional mask only)")
    parser.add_argument("--output", type=Path, default=ROOT / "docs/data/boundaries.json")
    parser.add_argument("--all-levels", action="store_true", help="Write all three LOD files beside --output (fixed filenames)")
    parser.add_argument("--level", choices=[level[0] for level in LEVELS], default="medium")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.all_levels and (args.claims is None or args.areas is None):
        parser.error("--all-levels requires --claims and --areas (China-claims worldview)")
    if args.all_levels:
        prepared = prepare_worldview(args.countries, args.regions, args.claims, args.areas)
        for level, filename, tolerance in LEVELS:
            data = export_level(*prepared, tolerance, level)
            write_export(data, args.output.parent / filename, args.check)
    else:
        tolerance = next(t for level, _, t in LEVELS if level == args.level)
        data = export(args.countries, args.regions, claims_path=args.claims,
                      areas_path=args.areas, tolerance=tolerance, level=args.level)
        write_export(data, args.output, args.check)


if __name__ == "__main__":
    main()
