#!/usr/bin/env python3
"""Export one reproducible, provisional CZ-6A visibility profile, without fitting.

Run with the astronomy environment (from any directory)::

    ~/.venvs/astro313/bin/python -I tools/export_profile.py
    ~/.venvs/astro313/bin/python -I tools/export_profile.py --check

Inputs are metadata.json and its three hashed, profile-local source files. The
original reverse-model project and raw catalog records are not needed. NumPy,
SciPy, pyproj and Skyfield are required. The only ephemeris opened is the shared
~/JPLDE/de440s.bsp; this exporter never downloads or copies a kernel.

Units: MET/cadence in seconds, geodetic longitude/latitude in degrees, WGS84
ellipsoidal altitude and geometric Sun ECEF vectors in km. Track sampling is
uniform, with slightly adjusted ~1 s / ~5 s cadences so endpoints are exact.
Tracks are keyed by meta.flight_segments. ECEF -> scene is the viewer's job
([x, z, -y]); no scene-axis rotation is baked into the solar vectors.
"""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import importlib.metadata
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
from pyproj import Transformer
from scipy.interpolate import CubicHermiteSpline, interp1d
from scipy.optimize import brentq
from skyfield.api import Loader, load_file
from skyfield.framelib import itrs

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROFILE = ROOT / "profiles" / "retrograde-142" / "yaogan50-03"
FAMILIES = ["retrograde", "polar", "sso", "low-inclination"]
RE_KM = 6378.137
AXES_KM = np.array([RE_KM, RE_KM, RE_KM * (1 - 1 / 298.257223563)])
MU_KM3_S2 = 398600.4418
TO_ECEF = Transformer.from_crs("EPSG:4979", "EPSG:4978", always_xy=True)
TO_GEO = Transformer.from_crs("EPSG:4978", "EPSG:4979", always_xy=True)
TRACK_FIELDS = {"met0", "dt", "lon", "lat", "alt", "color", "label"}
TOP_LEVEL_FIELDS = {"schema_version", "meta", "tracks", "zones", "events", "tle_ref", "sun"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def utc(text):
    value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    require(value.tzinfo is not None, "UTC input must include an explicit timezone")
    return value.astimezone(timezone.utc)


def iso(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def clock(meta, key):
    return utc(f"{meta['date']}T{meta[key]}Z")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def json_text(value):
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def geodetic_to_ecef(lon, lat, alt):
    return np.stack(TO_ECEF.transform(lon, lat, np.asarray(alt) * 1000), axis=-1) / 1000


def ecef_to_geodetic(position):
    lon, lat, height_m = TO_GEO.transform(*(np.asarray(position).T * 1000))
    return np.column_stack([lon, lat, np.asarray(height_m) / 1000])


def rotate_z(vector, angle):
    x, y, z = np.asarray(vector).T
    c, s = np.cos(angle), np.sin(angle)
    return np.column_stack([c * x - s * y, s * x + c * y, z])


def source_gmst(epoch):
    """Match the source model's GMST(UTC-as-UT1), not a different ITRS frame."""
    jd = epoch.timestamp() / 86400 + 2440587.5
    d = jd - 2451545
    t = d / 36525
    return np.radians((280.46061837 + 360.98564736629 * d
                       + 0.000387933 * t * t - t**3 / 38710000) % 360)


def source_paths(profile_dir, record):
    paths = {}
    for role, name in record["source"]["files"].items():
        require(Path(name).name == name and name not in ("", ".", ".."),
                "Sources must be profile-local basenames")
        path = profile_dir / name
        expected = record["source"]["sha256"][name]
        require(sha256(path) == expected, f"Source hash mismatch: {name}")
        paths[role] = path
    return paths


def trajectory_interpolator(path, record):
    """Use source ECEF positions; convert available TEME-like velocities first.

    The CSV stores WGS84 geodetic positions rather than explicit ECEF columns.
    Their inverse transform supplies the ECEF positions without inventing a new
    orbit. The derivative conversion includes -omega x r, not rotation alone.
    If velocity columns are unavailable, use linear ECEF interpolation rather
    than estimate unobserved derivatives. No source phase names become events.
    """
    with path.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    require(len(rows) >= 2, "Trajectory requires at least two samples")
    times = np.array([float(row["t_since_T0_s"]) for row in rows])
    position = geodetic_to_ecef(
        np.array([float(row["lon_deg"]) for row in rows]),
        np.array([float(row["lat_deg"]) for row in rows]),
        np.array([float(row["alt_wgs84_km"]) for row in rows]),
    )
    require(np.isfinite(times).all() and np.isfinite(position).all(), "Nonfinite source sample")
    require(np.all(np.diff(times) > 0), "Source MET must be strictly increasing")
    velocity_columns = ("vx_teme_km_s", "vy_teme_km_s", "vz_teme_km_s")
    has_velocity = all(column in rows[0] for column in velocity_columns)
    frame_error_km = None
    if has_velocity:
        inertial_r = np.array([[float(row[k]) for k in
                               ("x_teme_km", "y_teme_km", "z_teme_km")] for row in rows])
        inertial_v = np.array([[float(row[k]) for k in velocity_columns] for row in rows])
        rate = record["source"]["earth_rotation_rad_s"]
        angle = source_gmst(utc(record["source"]["nominal_launch_utc"])) + rate * times
        velocity = rotate_z(inertial_v - np.cross([0, 0, rate], inertial_r), -angle)
        require(np.isfinite(velocity).all(), "Nonfinite source velocity")
        frame_error_km = float(np.max(np.linalg.norm(rotate_z(inertial_r, -angle) - position, axis=1)))
        # Six-decimal source MET and nine-decimal geodetic coordinates are rounded.
        require(frame_error_km < 0.00002, "Source geodetic and inertial frames disagree")
        interpolate = CubicHermiteSpline(times, position, velocity, axis=0, extrapolate=False)
        method = "cubic Hermite in ECEF using transformed source velocities"
    else:
        interpolate = interp1d(times, position, axis=0, bounds_error=True)
        method = "linear in ECEF; source velocities unavailable"
    summary = {
        "source_samples": len(times),
        "source_interval_met_s": [float(times[0]), float(times[-1])],
        "interpolation": method,
        "source_frame_roundtrip_max_km": frame_error_km,
    }
    return interpolate, summary


def uniform_track(interpolate, start, finish, target_dt, color, label):
    intervals = max(1, round((finish - start) / target_dt))
    dt = (finish - start) / intervals
    times = start + np.arange(intervals + 1) * dt
    times[-1] = finish
    geo = ecef_to_geodetic(interpolate(times))
    require(np.isfinite(geo).all(), "Requested track exceeds the source interval")
    return {
        "met0": start,
        "dt": dt,
        "lon": geo[:, 0].tolist(),
        "lat": geo[:, 1].tolist(),
        "alt": geo[:, 2].tolist(),
        "color": color,
        "label": label,
    }


def booster_zone(path, record):
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    root = ET.parse(path).getroot()
    polygons = root.findall(".//k:Polygon/k:outerBoundaryIs/k:LinearRing/k:coordinates", ns)
    require(len(polygons) == 1, "Expected one NOTAM outer polygon")
    ring = [[float(v) for v in item.split(",")[:2]] for item in polygons[0].text.split()]
    require(len(ring) >= 4 and ring[0] == ring[-1], "NOTAM ring must be closed")
    zone = copy.deepcopy(record["zone"])
    zone["ring"] = ring
    require(np.allclose(np.mean(ring[:-1], axis=0), zone["centroid"], atol=1e-10, rtol=0),
            "NOTAM centroid differs from the sanitized source metadata")
    return zone


def tle_reference(path, record):
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    require(len(lines) == 3, "Expected a named, single-set reference TLE")
    require(lines[0] == "YAOGAN-50 03 PRELAUNCH MODEL - NOT OBSERVED", "TLE must be labeled synthetic")
    for number, line in enumerate(lines[1:], 1):
        require(len(line) == 69 and line.startswith(f"{number} 00000"), "Invalid placeholder TLE line")
        checksum = sum(int(c) if c.isdigit() else int(c == "-") for c in line[:68]) % 10
        require(checksum == int(line[68]), "TLE checksum mismatch")
    return {
        "t0": record["source"]["nominal_launch_utc"],
        "raan_rate_deg_per_min": record["source"]["raan_rate_deg_per_min"],
        "sets": [{"name": lines[0], "l1": lines[1], "l2": lines[2]}],
    }


def solar_table(meta, end_met, sampling):
    """Evaluate geometric geocentric DE440s Sun vectors in real ITRS/ECEF.

    Time arithmetic is on Skyfield's uniform TT scale. No light-time,
    aberration, refraction, or scene-coordinate transform is applied.
    """
    require(sampling["kernel"] == "de440s.bsp", "Use the shared DE440s kernel")
    directory = Path.home() / "JPLDE"
    kernel = directory / sampling["kernel"]
    require(kernel.is_file(), "Missing shared ~/JPLDE/de440s.bsp; no download is attempted")
    start = clock(meta, "t0_min") + timedelta(
        seconds=sampling["minimum_prelaunch_met_s"] - sampling["padding_s"])
    finish = clock(meta, "t0_max") + timedelta(seconds=end_met + sampling["padding_s"])
    dt = sampling["dt_s"]
    intervals = math.ceil((finish - start).total_seconds() / dt)
    seconds = np.arange(intervals + 1, dtype=float) * dt
    timescale = Loader(str(directory)).timescale(builtin=True)
    t_start = timescale.from_datetime(start)
    times = timescale.tt_jd(t_start.tt + seconds / 86400)
    ephemeris = load_file(str(kernel))
    try:
        vectors = (ephemeris["sun"] - ephemeris["earth"]).at(times).frame_xyz(itrs).km.T
    finally:
        ephemeris.close()
    return {
        "start_utc": iso(start), "dt": dt,
        "vectors": vectors.tolist(), "model": sampling["model"],
    }, {"file": kernel.name, "sha256": sha256(kernel)}


def make_mission(record, paths):
    meta = copy.deepcopy(record["meta"])
    insertion = meta["insertion_met"]
    end = insertion + meta["orbit_revolutions"] * meta["period_s"]
    meta.update({
        "flight_segments": ["ascent", "orbit"],
        "powered_intervals": [[0, insertion]],
        "phases": [
            {"until": 0, "label": "Pre-launch"},
            {"until": insertion, "label": "Ascent"},
            {"until": end, "label": "Inserted orbit"},
        ],
    })
    interpolate, summary = trajectory_interpolator(paths["trajectory"], record)
    require(summary["source_interval_met_s"][0] <= 0 and summary["source_interval_met_s"][1] >= end,
            "Source trajectory does not cover the full requested duration")
    tracks = {
        "ascent": uniform_track(interpolate, 0, insertion, 1, "#d95926", "Ascent"),
        "orbit": uniform_track(interpolate, insertion, end, 5, "#3987e5", "Inserted orbit"),
    }
    # One literally identical shared endpoint, not just a tolerance-based join.
    for coordinate in ("lon", "lat", "alt"):
        tracks["orbit"][coordinate][0] = tracks["ascent"][coordinate][-1]
    sun, kernel = solar_table(meta, end, record["sun_sampling"])
    events = [
        {"met": 0, "label": "Liftoff", "major": True, "kind": "ship"},
        {"met": insertion, "label": "Insertion", "major": True, "kind": "ship"},
        {"met": insertion + meta["period_s"], "label": "1 revolution", "major": False, "kind": "ship"},
        {"met": end, "label": "1.5 revolutions", "major": False, "kind": "ship"},
    ]
    mission = {
        "schema_version": 1,
        "meta": meta,
        "tracks": tracks,
        "zones": [booster_zone(paths["notam"], record)],
        "events": events,
        "tle_ref": tle_reference(paths["tle"], record),
        "sun": sun,
    }
    return mission, summary, kernel


def make_manifest(record, existing=None):
    profile = copy.deepcopy(record["profile"])
    require(profile["family"] in FAMILIES, "Unsupported profile family")
    mission = copy.deepcopy(record["mission"])
    if existing is None:
        profile["missions"] = [mission]
        return {
            "schema_version": 1,
            "default_profile": profile["id"],
            "profiles": [profile],
            "supported_families": FAMILIES,
        }
    manifest = copy.deepcopy(existing)
    require(manifest.get("schema_version") == 1 and isinstance(manifest.get("profiles"), list),
            "Cannot merge an unsupported manifest")
    matched = next((p for p in manifest["profiles"] if p["id"] == profile["id"]), None)
    if matched is None:
        profile["missions"] = [mission]
        manifest["profiles"].append(profile)
    else:
        missions = matched["missions"]
        position = next((i for i, m in enumerate(missions) if m["id"] == mission["id"]), None)
        if position is None:
            missions.append(mission)
        else:
            missions[position] = mission
    return manifest


def sunlight_clearance(position, sun):
    """Positive if the spacecraft-to-Sun-centre segment misses WGS84 Earth."""
    r = np.asarray(position) / AXES_KM
    d = (np.asarray(sun) - position) / AXES_KM
    fraction = np.clip(-np.sum(r * d, axis=-1) / np.sum(d * d, axis=-1), 0, 1)
    closest = r + np.asarray(fraction)[..., None] * d
    return np.sum(closest * closest, axis=-1) - 1


def sample_uniform(values, start, dt, when):
    offset = (np.asarray(when) - start) / dt
    require(np.all(offset >= -1e-10) and np.all(offset <= len(values) - 1 + 1e-10),
            "Interpolation request outside exported coverage")
    index = np.clip(np.floor(offset).astype(int), 0, len(values) - 2)
    fraction = np.clip(offset - index, 0, 1)
    return values[index] * (1 - fraction[..., None]) + values[index + 1] * fraction[..., None]


def validate(mission, record, summary, kernel):
    """Validate JSON-roundtripped exported samples, not the original fit."""
    require(set(mission) == TOP_LEVEL_FIELDS, "Unexpected mission top-level schema")
    require(mission["schema_version"] == 1, "Invalid schema version")
    meta, tracks, sun = mission["meta"], mission["tracks"], mission["sun"]
    insertion, period = meta["insertion_met"], meta["period_s"]
    end = insertion + 1.5 * period
    checks = {}
    require(set(tracks) == {"ascent", "orbit"}, "Expected ascent and orbit tracks only")
    reconstructed = {}
    track_summary = {}
    for name, track in tracks.items():
        require(set(track) == TRACK_FIELDS, f"Invalid {name} track schema")
        lengths = [len(track[k]) for k in ("lon", "lat", "alt")]
        require(len(set(lengths)) == 1 and lengths[0] > 1, f"Mismatched {name} arrays")
        require(track["dt"] > 0, "Nonpositive track cadence")
        geo = np.column_stack([track[k] for k in ("lon", "lat", "alt")])
        require(np.isfinite(geo).all(), "Nonfinite track value")
        require(np.all(np.abs(geo[:, 0]) <= 180) and np.all(np.abs(geo[:, 1]) <= 90),
                "Invalid geodetic coordinate")
        require(np.all(geo[:, 2] >= 0), "Below-surface track")
        positions = geodetic_to_ecef(geo[:, 0], geo[:, 1], geo[:, 2])
        reconstructed[name] = positions
        track_end = track["met0"] + track["dt"] * (lengths[0] - 1)
        expected_end = insertion if name == "ascent" else end
        require(track_end == expected_end, f"{name} endpoint is not exact")
        roundtrip = float(np.max(np.linalg.norm(
            geodetic_to_ecef(*ecef_to_geodetic(positions).T) - positions, axis=1)))
        require(roundtrip < 0.00002, "WGS84 coordinate roundtrip failed")
        target_dt = 1 if name == "ascent" else 5
        require(abs(track["dt"] - target_dt) < 0.01, "Unexpected uniform track cadence")
        track_summary[name] = {
            "samples": lengths[0], "met0": track["met0"], "dt_s": track["dt"],
            "end_met_s": track_end, "wgs84_roundtrip_max_km": roundtrip,
        }
    require(all(tracks["ascent"][k][-1] == tracks["orbit"][k][0] for k in ("lon", "lat", "alt")),
            "Ascent and orbit do not share an exact endpoint")
    require(tracks["ascent"]["met0"] == 0 and tracks["orbit"]["met0"] == insertion,
            "Invalid track start MET")
    require((end - insertion) / period == 1.5, "Not exactly 1.5 periods")
    a = RE_KM + (meta["perigee_km"] + meta["apogee_km"]) / 2
    require(abs(2 * np.pi * np.sqrt(a**3 / MU_KM3_S2) - period) < 1e-8,
            "Period disagrees with insertion Keplerian elements")
    checks["track_arrays_finite_and_uniform"] = True
    checks["exact_shared_insertion_endpoint"] = True
    checks["exact_1_5_keplerian_period_duration"] = True
    checks["wgs84_roundtrip"] = True

    require(set(sun) == {"start_utc", "dt", "vectors", "model"}, "Unexpected solar schema")
    vectors = np.asarray(sun["vectors"])
    require(vectors.ndim == 2 and vectors.shape[1] == 3 and np.isfinite(vectors).all(),
            "Invalid solar vector array")
    require(np.all((np.linalg.norm(vectors, axis=1) > 1.4e8)
                   & (np.linalg.norm(vectors, axis=1) < 1.6e8)), "Solar vectors must be km")
    start = utc(sun["start_utc"])
    finish = start + timedelta(seconds=sun["dt"] * (len(vectors) - 1))
    sampling = record["sun_sampling"]
    needed_start = clock(meta, "t0_min") + timedelta(
        seconds=sampling["minimum_prelaunch_met_s"] - sampling["padding_s"])
    needed_end = clock(meta, "t0_max") + timedelta(seconds=end + sampling["padding_s"])
    require(start == needed_start and finish >= needed_end, "Insufficient solar coverage")
    require((finish - needed_end).total_seconds() < sun["dt"], "Unnecessary extra solar interval")
    nominal_offset = (clock(meta, "t0_default") - start).total_seconds()
    ascent = tracks["ascent"]

    def clearance(t, mode="ecef_linear"):
        if mode == "ecef_linear":
            position = sample_uniform(reconstructed["ascent"], ascent["met0"], ascent["dt"], t)
        else:
            # Also verify a viewer that linearly interpolates geodetic samples.
            geo = np.column_stack([ascent[k] for k in ("lon", "lat", "alt")])
            p = sample_uniform(geo, ascent["met0"], ascent["dt"], t)
            position = geodetic_to_ecef(*p)
        solar = sample_uniform(vectors, 0, sun["dt"], nominal_offset + t)
        return float(sunlight_clearance(position, solar))

    times = ascent["met0"] + np.arange(len(ascent["lon"])) * ascent["dt"]
    clearances = np.array([clearance(t) for t in times])
    transitions = np.flatnonzero((clearances[:-1] <= 0) & (clearances[1:] > 0))
    require(len(transitions) > 0, "No exported-sample sunlight pickup")
    j = transitions[0]
    pickup = float(brentq(clearance, times[j], times[j + 1], xtol=1e-8))
    pickup_geo_linear = float(brentq(lambda t: clearance(t, "geodetic_linear"),
                                    times[j], times[j + 1], xtol=1e-8))
    expected_pickup = record["source"]["nominal_pickup_met_s"]
    require(abs(pickup - expected_pickup) < 0.1 and abs(pickup_geo_linear - expected_pickup) < 0.1,
            "Exported-sample pickup differs from the source reference by >=0.1 s")
    require(clearance(pickup - 0.1) < 0 < clearance(pickup + 0.1), "Shadow transition failed")
    checks["solar_km_units_and_full_t0_prelaunch_coverage"] = True
    checks["nominal_pickup_within_0_1_s"] = True
    checks["shadow_before_and_sunlight_after_pickup"] = True
    expected_events = [0, insertion, insertion + period, end]
    require([e["met"] for e in mission["events"]] == expected_events,
            "Only liftoff, insertion, 1 and 1.5 revolution events are permitted")
    require(all(set(e) == {"met", "label", "major", "kind"} and e["kind"] == "ship"
                for e in mission["events"]), "Unexpected event schema")
    require(len(mission["zones"]) == 1 and mission["zones"][0]["role"] == "boosters",
            "Expected one booster zone and no impacts")
    checks["only_authorized_events_and_booster_zone"] = True
    serialized = json_text(mission) + json_text(record)
    require("/Users/" not in serialized and "space_track/" not in serialized,
            "Unsanitized source path in public metadata")
    checks["sanitized_metadata"] = True
    return {
        "schema_version": 1,
        "profile": record["profile"]["id"], "mission": record["mission"]["id"],
        "checks": checks,
        "source": summary,
        "tracks": track_summary,
        "orbit_duration_s": end - insertion,
        "orbit_duration_periods": (end - insertion) / period,
        "insertion_join_ecef_km": float(np.linalg.norm(reconstructed["ascent"][-1]
                                                       - reconstructed["orbit"][0])),
        "sun": {
            "samples": len(vectors), "dt_s": sun["dt"],
            "start_utc": sun["start_utc"], "end_utc": iso(finish),
            "required_end_utc": needed_end.isoformat().replace("+00:00", "Z"),
            "minimum_prelaunch_met_s": sampling["minimum_prelaunch_met_s"],
            "kernel": kernel,
        },
        "nominal_pickup": {
            "reference_met_s": expected_pickup,
            "ecef_linear_met_s": pickup,
            "geodetic_linear_met_s": pickup_geo_linear,
            "ecef_linear_error_s": pickup - expected_pickup,
            "geodetic_linear_error_s": pickup_geo_linear - expected_pickup,
        },
        "dependencies": {name: importlib.metadata.version(name)
                         for name in ("numpy", "scipy", "pyproj", "skyfield", "jplephem")},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile-dir", type=Path, default=DEFAULT_PROFILE,
                        help="Directory containing sanitized metadata.json and source files")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "docs" / "data",
                        help="Destination for mission JSON and profiles.json")
    parser.add_argument("--validation", type=Path, default=ROOT / "tests" / "profile_validation.json",
                        help="Validation report (written on export, compared with --check)")
    parser.add_argument("--check", action="store_true", help="Validate and compare existing exports; write nothing")
    args = parser.parse_args()
    metadata_path = args.profile_dir / "metadata.json"
    record = json.loads(metadata_path.read_text(encoding="utf-8"))
    require(record["schema_version"] == 1, "Invalid source metadata schema")
    require(clock(record["meta"], "t0_default") == utc(record["source"]["nominal_launch_utc"]),
            "Nominal T0 and source epoch must agree")
    paths = source_paths(args.profile_dir, record)
    mission, summary, kernel = make_mission(record, paths)
    manifest_path = args.output_dir / "profiles.json"
    existing = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else None
    manifest = make_manifest(record, existing)
    # Roundtrip through the exact serialization that the viewer receives.
    mission_text = json_text(mission)
    report = validate(json.loads(mission_text), record, summary, kernel)
    report["inputs_sha256"] = {"metadata.json": sha256(metadata_path), **record["source"]["sha256"]}
    report["outputs_sha256"] = {
        record["mission"]["id"] + ".json": hashlib.sha256(mission_text.encode()).hexdigest(),
        "profiles.json": hashlib.sha256(json_text(manifest).encode()).hexdigest(),
    }
    mission_file = record["mission"]["file"]
    require(mission_file == f"data/{record['mission']['id']}.json", "Unexpected mission output URL")
    outputs = {
        args.output_dir / Path(mission_file).name: mission_text,
        args.output_dir / "profiles.json": json_text(manifest),
        args.validation: json_text(report),
    }
    for path, content in outputs.items():
        if args.check:
            require(path.is_file() and path.read_text(encoding="utf-8") == content,
                    f"Reproducibility check failed: {path.name}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
    print(json.dumps({"mode": "checked" if args.check else "exported",
                      "profile": record["profile"]["id"], "checks_passed": len(report["checks"]),
                      "nominal_pickup_met_s": report["nominal_pickup"]["ecef_linear_met_s"],
                      "sun_start_utc": mission["sun"]["start_utc"],
                      "sun_end_utc": report["sun"]["end_utc"]}, indent=2))


if __name__ == "__main__":
    main()
