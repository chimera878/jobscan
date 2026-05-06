#!/usr/bin/env python3
"""
Tests for adzuna_scan.py.

Unit tests (no network):  python test_adzuna.py TestLocationResolution TestUnsupportedRegionCLI
All tests (hits Adzuna):  python test_adzuna.py
"""

import io
import json
import sys
import subprocess
import unittest

sys.path.insert(0, ".")
from adzuna_scan import _resolve_location, _COUNTRIES, main


class TestLocationResolution(unittest.TestCase):
    """Unit tests — no network calls."""

    def test_uk_aliases_resolve_correctly(self):
        for loc in ["UK", "United Kingdom", "Great Britain", "England", "gb"]:
            with self.subTest(loc=loc):
                result = _resolve_location(loc)
                self.assertIsNotNone(result, f"{loc!r} should be supported")
                code, where = result
                self.assertEqual(code, "gb")
                self.assertEqual(where, "UK")

    def test_us_aliases_resolve_correctly(self):
        for loc in ["United States", "USA", "US", "America"]:
            with self.subTest(loc=loc):
                result = _resolve_location(loc)
                self.assertIsNotNone(result, f"{loc!r} should be supported")
                code, where = result
                self.assertEqual(code, "us")
                self.assertEqual(where, "US")

    def test_unsupported_region_returns_none(self):
        for loc in ["China", "Japan", "South Korea", "xyz"]:
            with self.subTest(loc=loc):
                self.assertIsNone(_resolve_location(loc))

    def test_lookup_is_case_insensitive(self):
        self.assertEqual(_resolve_location("united kingdom"), _resolve_location("UNITED KINGDOM"))
        self.assertEqual(_resolve_location("uk"), _resolve_location("UK"))

    def test_api_url_uses_correct_country_code(self):
        code, _ = _resolve_location("United Kingdom")
        self.assertIn(f"/jobs/{code}/search", f"https://api.adzuna.com/v1/api/jobs/{code}/search")


class TestUnsupportedRegionCLI(unittest.TestCase):
    """Verify China prints a clear error and returns [] without crashing."""

    def _run_main(self, args):
        old_argv, old_stderr, old_stdout = sys.argv, sys.stderr, sys.stdout
        try:
            sys.argv   = ["adzuna_scan.py"] + args
            sys.stderr = io.StringIO()
            sys.stdout = io.StringIO()
            main()
            return sys.stdout.getvalue(), sys.stderr.getvalue()
        finally:
            sys.argv, sys.stderr, sys.stdout = old_argv, old_stderr, old_stdout

    def test_unsupported_region_exits_cleanly(self):
        stdout, stderr = self._run_main(["software engineer", "China", "5"])
        self.assertEqual(json.loads(stdout), [], "stdout should be empty JSON array")

    def test_unsupported_region_prints_helpful_error(self):
        stdout, stderr = self._run_main(["software engineer", "China", "5"])
        self.assertIn("unsupported region", stderr)
        self.assertIn("China", stderr)
        self.assertIn("Adzuna is available in", stderr)

    def test_supported_countries_listed_in_error(self):
        stdout, stderr = self._run_main(["software engineer", "China", "5"])
        self.assertIn("UK", stderr)
        self.assertIn("US", stderr)
        self.assertIn("Australia", stderr)


class TestLiveAPI(unittest.TestCase):
    """Integration tests — hit the real Adzuna API. Requires portals.yml with valid keys."""

    def _scan(self, query, location, max_age=3):
        result = subprocess.run(
            [sys.executable, "adzuna_scan.py", query, location, str(max_age)],
            capture_output=True, text=True, timeout=60,
        )
        return json.loads(result.stdout), result.stderr

    def test_uk_returns_jobs(self):
        jobs, stderr = self._scan("software engineer", "United Kingdom")
        self.assertGreater(len(jobs), 0, f"Expected jobs from UK. stderr: {stderr}")

    def test_uk_jobs_have_required_fields(self):
        jobs, _ = self._scan("software engineer", "UK")
        for job in jobs[:5]:
            with self.subTest(url=job.get("url")):
                self.assertIn("title",    job)
                self.assertIn("company",  job)
                self.assertIn("location", job)
                self.assertIn("url",      job)
                self.assertIn("age_days", job)

    def test_us_returns_jobs(self):
        jobs, stderr = self._scan("software engineer", "United States")
        self.assertGreater(len(jobs), 0, f"Expected jobs from US. stderr: {stderr}")

    def test_us_jobs_have_required_fields(self):
        jobs, _ = self._scan("software engineer", "US")
        for job in jobs[:5]:
            with self.subTest(url=job.get("url")):
                self.assertIn("title",    job)
                self.assertIn("url",      job)
                self.assertIn("age_days", job)


if __name__ == "__main__":
    unittest.main(verbosity=2)
