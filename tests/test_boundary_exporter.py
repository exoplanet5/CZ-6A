"""Boundary worldview, geometry and LOD regression tests (no network access).

Optional source-level/rebuild tests: set CZ6A_BOUNDARY_SOURCES to a JSON object
with countries, regions, claims, areas and optionally legacy_countries paths.
Run with python -I so downloaded GeoJSON directories cannot shadow imports.
"""
import importlib.util
import json
import os
from pathlib import Path
import unittest

from shapely import line_merge
from shapely.geometry import LineString, MultiLineString, Point, box, shape

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("boundary_exporter", ROOT / "tools/export_boundaries.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
DATA = [json.loads((ROOT / "docs/data" / filename).read_text()) for _, filename, _ in exporter.LEVELS]


class ClassificationTests(unittest.TestCase):
    def test_worldview_overrides_default_and_unknown_is_not_promoted(self):
        self.assertEqual(exporter.classify({"FEATURECLA": "Disputed (please verify)",
                                           "FCLASS_CN": exporter.INTERNATIONAL})[1], "countries")
        self.assertIsNone(exporter.classify({"FEATURECLA": exporter.INTERNATIONAL,
                                            "FCLASS_CN": "Unrecognized"})[1])
        self.assertIsNone(exporter.classify({"FEATURECLA": "Unrecognized Admin-1 boundary"})[1])
        self.assertEqual(exporter.classify({"FEATURECLA": exporter.INTERNATIONAL,
                                           "FCLASS_CN": "Map unit boundary"})[1], "regions")
        for value in ["Disputed (please verify)", "Indefinite (please verify)",
                      "Line of control (please verify)", "future unknown class"]:
            self.assertEqual(exporter.classify({"FEATURECLA": value})[1], "disputed")
        self.assertEqual(exporter.classify({})[1], "disputed")

    def test_wrap_and_degenerate_lines(self):
        with self.assertRaisesRegex(ValueError, "antimeridian"):
            exporter.rounded_line(LineString([(179, 20), (-179, 21)]), 0.1)
        self.assertIsNone(exporter.rounded_line(LineString([(0, 0), (0.000001, 0)]), 0.02))
        self.assertEqual(exporter.rounded_line(LineString([(100, 30), (101, 30)]), 0.1),
                         [[100.0, 30.0], [101.0, 30.0]])

    def test_incomplete_worldview_and_unpinned_sources_fail(self):
        with self.assertRaisesRegex(ValueError, "both"):
            exporter.export(Path("unused"), Path("unused"), claims_path=Path("unused"))
        # A trusted project file is intentionally not one of the pinned sources.
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            exporter.read_source("claims", ROOT / "tools/export_boundaries.py")


class CommittedBoundaryTests(unittest.TestCase):
    def test_provenance_detail_and_coordinate_budget(self):
        totals = []
        for data, (level, _, tolerance) in zip(DATA, exporter.LEVELS):
            self.assertEqual(data["schema_version"], 1)
            self.assertEqual(data["source"]["worldview"], "China claims")
            self.assertEqual(data["source"]["level"], level)
            self.assertEqual(data["source"]["simplification_degrees"], tolerance)
            self.assertEqual(data["source"]["revision"], exporter.REVISION)
            self.assertIn("administered by India", data["source"]["boundary_note"])
            self.assertIn("disputes are resolved", data["source"]["boundary_note"])
            for key, source in data["source"]["files"].items():
                filename, digest = exporter.SOURCES[key]
                self.assertEqual(source["sha256"], digest)
                self.assertIn(f"/{exporter.REVISION}/geojson/{filename}", source["url"])
            self.assertIn("countries10m", data["source"]["files"])
            self.assertNotIn("countries", data["source"]["files"])
            total = sum(sum(map(len, lines)) for lines in data["layers"].values())
            self.assertEqual(total, data["coverage"]["total_points"])
            totals.append(total)
        self.assertLess(totals[0], totals[1])
        self.assertLess(totals[1] * 2, totals[2])
        self.assertLessEqual(totals[2], exporter.MAX_FINE_POINTS)

    def test_global_coverage_and_geographic_validity(self):
        for data in DATA:
            coverage = data["coverage"]
            self.assertGreaterEqual(coverage["region_line_counts"]["CHN"], 50)
            self.assertGreater(len(coverage["region_line_counts"]), 150)
            for code in ["CHN", "IND", "USA", "RUS", "CAN", "VNM", "JPN", "NPL"]:
                self.assertGreater(coverage["region_line_counts"][code], 0)
            for key, lines in data["layers"].items():
                self.assertEqual(len(lines), coverage["line_counts"][key])
                self.assertEqual(sum(map(len, lines)), coverage["point_counts"][key])
                for line in lines:
                    self.assertGreaterEqual(len(set(map(tuple, line))), 2)
                    for lon, lat in line:
                        self.assertTrue(-180 <= lon <= 180 and -90 <= lat <= 90)
                    self.assertTrue(all(abs(a[0] - b[0]) <= 180 for a, b in zip(line, line[1:])))
            # Province boundaries in the actual mission-region interior survive.
            shanxi = box(105, 30, 115, 42)
            self.assertGreater(sum(shanxi.contains(LineString(line))
                                   for line in data["layers"]["regions"]), 5)

    def test_southern_tibet_claim_present_not_just_mcmahon_hidden(self):
        # Exact endpoints from pinned B00 Chinese-claim feature 1746705431;
        # intermediate coordinates are independent samples from that feature.
        samples = [Point(94.777036, 27.694796), Point(95.842191, 28.262514)]
        claim_lengths = []
        for data in DATA:
            audit = data["coverage"]["southern_tibet"]
            self.assertEqual(audit["claim_ne_id"], 1746705431)
            self.assertEqual(audit["omitted_land_ne_id"], 1746705337)
            self.assertEqual(audit["claim_layer"], "countries")
            lines = [data["layers"]["countries"][i] for i in audit["claim_line_indices"]]
            self.assertEqual(lines[0][0], [97.0362, 27.7429])
            self.assertEqual(lines[0][-1], [92.0359, 26.8548])
            claim = MultiLineString(lines)
            self.assertTrue(box(90, 26, 98, 30).contains(claim))
            tolerance = data["source"]["simplification_degrees"] + 0.0001
            for sample in samples:
                self.assertLessEqual(claim.distance(sample), tolerance)
            claim_lengths.append(sum(map(len, lines)))
            # Neither country nor province/control styling resurrects the old
            # McMahon/de facto line (two interior source samples, not endpoints).
            for key in ["countries", "regions", "disputed"]:
                rendered = MultiLineString(data["layers"][key])
                self.assertGreater(rendered.distance(Point(94.135396, 28.897788)), 0.5)
                self.assertGreater(rendered.distance(Point(96.441127, 28.395416)), 0.15)
            overrides = {item["ne_id"]: item for item in data["coverage"]["worldview_overrides"]}
            self.assertIsNone(overrides[1746705337]["layer"])
            self.assertIsNone(overrides[1746750371]["layer"])  # Assam-Arunachal regional overlap
            self.assertEqual(overrides[1746705431]["layer"], "countries")
        self.assertLess(claim_lengths[0], claim_lengths[1])
        self.assertLess(claim_lengths[1], claim_lengths[2])

    def test_semantic_decisions_match_across_all_levels(self):
        first = DATA[0]
        for data in DATA[1:]:
            for key in ["classification_counts", "worldview_overrides", "regional_claim_masks",
                        "clipped_region_features", "region_line_counts", "line_counts"]:
                self.assertEqual(data["coverage"][key], first["coverage"][key])
        self.assertGreater(first["coverage"]["classification_counts"]["countries10m"]
                           ["Disputed (please verify) -> disputed"], 0)
        self.assertGreater(first["coverage"]["classification_counts"]["claims"]
                           ["Claim boundary -> disputed"], 0)


@unittest.skipUnless(os.environ.get("CZ6A_BOUNDARY_SOURCES"), "optional pinned source paths not configured")
class SourceGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.paths = {key: Path(value) for key, value in json.loads(os.environ["CZ6A_BOUNDARY_SOURCES"]).items()}
        cls.prepared = exporter.prepare_worldview(*(cls.paths[key] for key in ["countries", "regions", "claims", "areas"]))

    def test_rebuild_all_levels_byte_for_byte(self):
        for level, filename, tolerance in exporter.LEVELS:
            rebuilt = exporter.export_level(*self.prepared, tolerance, level)
            text = json.dumps(rebuilt, separators=(",", ":"), allow_nan=False) + "\n"
            self.assertEqual(text, (ROOT / "docs/data" / filename).read_text())

    def test_claim_is_exactly_sourced_before_simplification(self):
        claims, _ = exporter.read_source("claims", self.paths["claims"])
        feature = next(f for f in claims["features"] if f["properties"]["ne_id"] == 1746705431)
        self.assertEqual(feature["properties"]["NAME"], "Chinese claim")
        self.assertEqual(feature["properties"]["FCLASS_CN"], exporter.INTERNATIONAL)
        original = line_merge(shape(feature["geometry"]))
        for data in DATA:
            lines = [data["layers"]["countries"][i] for i in data["coverage"]["southern_tibet"]["claim_line_indices"]]
            self.assertLessEqual(original.hausdorff_distance(MultiLineString(lines)),
                                 data["source"]["simplification_degrees"] + 0.0001)

    def test_no_regional_lines_are_invented_inside_claim(self):
        areas, _ = exporter.read_source("areas", self.paths["areas"])
        polygon = shape(next(f for f in areas["features"] if f["properties"]["BRK_A3"] == "B00")["geometry"])
        regions = [line for target, line, *_ in self.prepared[0] if target == "regions"]
        self.assertEqual(sum(line.intersection(polygon.buffer(-0.00001)).length for line in regions), 0)
        # Simplification can cut cartographic corners by its tolerance, but it
        # must not create a substantial interior provincial boundary at any LOD.
        for data in DATA:
            interior = polygon.buffer(-data["source"]["simplification_degrees"] - 0.0001)
            self.assertEqual(MultiLineString(data["layers"]["regions"]).intersection(interior).length, 0)

    def test_legacy_single_export_remains_available(self):
        if "legacy_countries" not in self.paths:
            self.skipTest("legacy 50m input not configured")
        result = exporter.export(self.paths["legacy_countries"], self.paths["regions"])
        self.assertEqual(result["schema_version"], 1)
        self.assertIn("legacy", result["source"]["worldview"])
        self.assertGreaterEqual(result["coverage"]["region_line_counts"]["CHN"], 50)


if __name__ == "__main__":
    unittest.main()
