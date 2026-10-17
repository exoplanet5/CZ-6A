"""Manifest updates must not erase future mission configurations."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("export_profile", ROOT / "tools/export_profile.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
RECORD = json.loads((ROOT / "profiles/retrograde-142/yaogan50-03/metadata.json").read_text())


class ManifestTests(unittest.TestCase):
    def test_new_manifest_default(self):
        result = exporter.make_manifest(RECORD)
        self.assertEqual(result["default_profile"], "retrograde-142")
        self.assertEqual(len(result["profiles"]), 1)

    def test_merge_preserves_other_profiles_missions_and_defaults(self):
        original = exporter.make_manifest(RECORD)
        other = copy.deepcopy(original["profiles"][0])
        other["id"] = "unit-test-polar-fixture"
        original["profiles"].append(other)
        original["default_profile"] = other["id"]
        original["profiles"][0]["missions"].append({"id": "fixture", "label": "Test fixture", "file": "data/fixture.json"})
        original["profiles"][0]["default_mission"] = "fixture"
        before = copy.deepcopy(original)
        result = exporter.make_manifest(RECORD, original)
        self.assertEqual(result, before)
        self.assertEqual(original, before)
        self.assertIsNot(result, original)

    def test_unknown_manifest_version_is_not_overwritten(self):
        with self.assertRaises(ValueError):
            exporter.make_manifest(RECORD, {"schema_version": 99, "profiles": []})


if __name__ == "__main__":
    unittest.main()
