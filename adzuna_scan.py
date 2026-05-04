#!/usr/bin/env python3
"""
adzuna_scan.py — Adzuna job API client (multi-region).

Reads app_id and app_key from portals.yml (adzuna.app_id / adzuna.app_key).
Called by scan.mjs as a child process — outputs JSON to stdout.

Usage:
    python adzuna_scan.py "graduate software engineer" "United States" 5
    python adzuna_scan.py "graduate software engineer" "UK" 5 --debug

Output: JSON array of {title, company, location, url, age_days}, or [] on failure.

Supported regions: Australia, Austria, Belgium, Brazil, Canada, France, Germany,
India, Italy, Mexico, Netherlands, New Zealand, Poland, Russia, Singapore,
South Africa, United Kingdom, United States.
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

MAX_PAGES = 5
PER_PAGE  = 50

# Adzuna-supported country codes and their display names
_SUPPORTED = {
    "au": "Australia",
    "at": "Austria",
    "be": "Belgium",
    "br": "Brazil",
    "ca": "Canada",
    "fr": "France",
    "de": "Germany",
    "in": "India",
    "it": "Italy",
    "mx": "Mexico",
    "nl": "Netherlands",
    "nz": "New Zealand",
    "pl": "Poland",
    "ru": "Russia",
    "sg": "Singapore",
    "za": "South Africa",
    "gb": "United Kingdom",
    "us": "United States",
}

# Map verbose location strings → Adzuna country codes
_COUNTRY_CODE_MAP = {
    "australia": "au", "au": "au",
    "austria": "at", "at": "at",
    "belgium": "be", "be": "be",
    "brazil": "br", "brasil": "br", "br": "br",
    "canada": "ca", "ca": "ca",
    "france": "fr", "fr": "fr",
    "germany": "de", "deutschland": "de", "de": "de",
    "india": "in", "in": "in",
    "italy": "it", "italia": "it", "it": "it",
    "mexico": "mx", "méxico": "mx", "mx": "mx",
    "netherlands": "nl", "holland": "nl", "nl": "nl",
    "new zealand": "nz", "nz": "nz",
    "poland": "pl", "polska": "pl", "pl": "pl",
    "russia": "ru", "ru": "ru",
    "singapore": "sg", "sg": "sg",
    "south africa": "za", "za": "za",
    "united kingdom": "gb", "great britain": "gb", "gb": "gb", "uk": "gb",
    "england": "gb", "scotland": "gb", "wales": "gb",
    "united states": "us", "usa": "us", "us": "us", "america": "us",
}

_debug = False


def _get_country_code(location: str) -> str | None:
    return _COUNTRY_CODE_MAP.get(location.lower().strip())


def _load_keys() -> tuple:
    try:
        import yaml
        cfg = yaml.safe_load(Path("portals.yml").read_text())
        az = cfg.get("adzuna", {})
        return az.get("app_id", ""), az.get("app_key", "")
    except Exception:
        return "", ""


def _age_days(created: str):
    if not created:
        return None
    try:
        dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
        return max(0, (datetime.now(timezone.utc) - dt).days)
    except Exception:
        return None


def fetch_page(api_base: str, app_id: str, app_key: str, query: str, location: str, max_age: int, page: int) -> dict:
    params = urlencode({
        "app_id":          app_id,
        "app_key":         app_key,
        "what":            query,
        "where":           location,
        "max_days_old":    max_age,
        "results_per_page": PER_PAGE,
        "sort_by":         "date",
    })
    url = f"{api_base}/{page}?{params}"
    if _debug:
        print(f"[adzuna] GET {url}", file=sys.stderr)
    req = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except URLError as e:
        if _debug:
            print(f"[adzuna] fetch error: {e}", file=sys.stderr)
        return {}


_JOB_ID_RE  = re.compile(r'/(?:details|land/ad)/(\d+)')
_DOMAIN_RE  = re.compile(r'^(https?://[^/]+)')

def _canonical_url(raw: str, app_id: str = "") -> str:
    """Normalise any Adzuna URL to https://<regional-domain>/jobs/details/{id}?utm_medium=api&utm_source={app_id}.

    Extracts the domain from the raw URL so regional domains (adzuna.com, adzuna.com.au, etc.)
    are preserved. Converts 'land/ad/{id}' → 'details/{id}' and strips session-specific params.
    """
    m = _JOB_ID_RE.search(raw)
    if not m:
        return raw.strip()
    domain_m = _DOMAIN_RE.match(raw)
    domain = domain_m.group(1) if domain_m else "https://www.adzuna.co.uk"
    base = f"{domain}/jobs/details/{m.group(1)}"
    src_m = re.search(r'utm_source=([^&\s]+)', raw)
    source = src_m.group(1) if src_m else app_id
    if source:
        return f"{base}?utm_medium=api&utm_source={source}"
    return base


def parse_results(data: dict, app_id: str = "") -> list:
    jobs = []
    for j in data.get("results", []):
        jobs.append({
            "title":    (j.get("title") or "").strip(),
            "company":  (j.get("company") or {}).get("display_name", "").strip(),
            "location": (j.get("location") or {}).get("display_name", "").strip(),
            "url":      _canonical_url(j.get("redirect_url") or "", app_id),
            "age_days": _age_days(j.get("created", "")),
        })
    return jobs


def main():
    global _debug
    _debug = "--debug" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    if len(args) < 2:
        print("[]", flush=True)
        return

    query    = args[0]
    location = args[1]
    max_age  = int(args[2]) if len(args) > 2 else 5

    country_code = _get_country_code(location)
    if not country_code:
        supported = ", ".join(sorted(_SUPPORTED.values()))
        print(
            f"[adzuna] unsupported region {location!r} — Adzuna is available in: {supported}",
            file=sys.stderr,
        )
        print("[]", flush=True)
        return

    api_base = f"https://api.adzuna.com/v1/api/jobs/{country_code}/search"

    app_id, app_key = _load_keys()
    if not app_id or not app_key:
        print("[adzuna] app_id/app_key missing — add adzuna.app_id and adzuna.app_key to portals.yml", file=sys.stderr)
        print("[]", flush=True)
        return

    if _debug:
        print(f"[adzuna] query={query!r} location={location!r} country={country_code} max_age={max_age}", file=sys.stderr)

    all_jobs = []

    for page in range(1, MAX_PAGES + 1):
        data = fetch_page(api_base, app_id, app_key, query, location, max_age, page)

        if "exception" in data:
            print(f"[adzuna] API error: {data['exception']}", file=sys.stderr)
            break

        jobs = parse_results(data, app_id)
        if not jobs:
            if _debug:
                print(f"[adzuna] page {page}: no results — stopping", file=sys.stderr)
            break

        ages      = [j["age_days"] for j in jobs if j["age_days"] is not None]
        age_range = f"{min(ages)}–{max(ages)}d" if ages else "?"
        print(f"[adzuna] {query}: page {page} — {len(jobs)} jobs ({age_range})", file=sys.stderr, flush=True)

        all_jobs.extend(jobs)

        total_available = data.get("count", 0)
        if len(all_jobs) >= total_available:
            break

        if ages and min(ages) > max_age:
            break

    print(json.dumps(all_jobs), flush=True)


if __name__ == "__main__":
    main()