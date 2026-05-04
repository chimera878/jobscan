#!/usr/bin/env python3
"""
aijobs_scan.py — ai-jobs.net HTML scraper.

Derives search queries from keyword_filter.positive in portals.yml.
Called by scan.mjs as a child process — outputs JSON to stdout.

Usage:
    python aijobs_scan.py [max_age] [--debug]

Output: JSON array of {title, company, location, url, age_days}, or [] on failure.
company is always "" (not available in listing HTML).
"""

import json
import re
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE_URL  = "https://aijobs.net/"
MAX_PAGES = 5
MAX_QUERIES = 8

# Single-word / too-generic terms to skip on a specialist AI board
_SKIP_TERMS = {"graduate", "developer", "ai engineer"}

_debug = False


def _load_config() -> dict:
    try:
        import yaml
        return yaml.safe_load(Path("portals.yml").read_text()) or {}
    except Exception:
        return {}


def _derive_queries(cfg: dict) -> list[str]:
    raw = cfg.get("keyword_filter", {}).get("positive", [])
    seen, result = set(), []
    for term in raw:
        lower = term.lower()
        if lower in _SKIP_TERMS:
            continue
        if lower not in seen:
            seen.add(lower)
            result.append(lower)
        if len(result) >= MAX_QUERIES:
            break
    return result or ["machine learning", "software engineer"]


def _parse_age(text: str):
    """Parse relative age strings like '2d ago', '1w ago', '3mo ago'."""
    text = text.strip().lower()
    m = re.match(r'(\d+)\s*(m|h|d|w|mo)\s*ago', text)
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2)
    if unit in ('m', 'h'):
        return 0
    if unit == 'd':
        return n
    if unit == 'w':
        return n * 7
    if unit == 'mo':
        return n * 30
    return None


def _strip_tags(s: str) -> str:
    return re.sub(r'<[^>]+>', '', s).strip()


def _parse_jobs(html: str) -> list[dict]:
    """Parse job cards from aijobs.net listing HTML.

    Card structure (per <li>):
      Left col: <a href="/job/SLUG/" class="...stretched-link...">
                  [<span>Featured</span>] TITLE
                </a>
      Right col: <div class="text-end">
                   <div><span>Mid-level</span></div>   ← seniority badge
                   <div>Remote <span>R</span></div>    ← location text
                   <div class="text-muted">2d ago</div>← age
                 </div>
    """
    jobs = []

    # Split into per-card blocks
    li_blocks = re.findall(r'<li class="d-flex[^"]*"[^>]*>(.*?)</li>', html, re.DOTALL)

    for block in li_blocks:
        # Title + URL
        am = re.search(r'<a[^>]*href="(/job/[^"]+)"[^>]*>(.*?)</a>', block, re.DOTALL)
        if not am:
            continue
        url_path = am.group(1)
        # Strip all <span>...</span> badges (Featured, Feat.) then remaining text is the title
        anchor_inner = re.sub(r'<span[^>]*>.*?</span>', '', am.group(2), flags=re.DOTALL)
        title = _strip_tags(anchor_inner)
        if not title:
            continue
        url = f"https://aijobs.net{url_path}"

        # Right column: text-end div
        # Structure: divs[0]=text-end(partial), divs[1]=location, divs[2]=age
        te_idx = block.find('<div class="text-end">')
        location = ""
        age_days = None

        if te_idx != -1:
            te_section = block[te_idx:]
            divs = re.findall(r'<div[^>]*>(.*?)</div>', te_section, re.DOTALL)
            if len(divs) >= 2:
                # Strip badge spans (e.g. <span>R</span> remote indicator) before tag removal
                loc_html = re.sub(r'<span[^>]*>.*?</span>', '', divs[1], flags=re.DOTALL)
                location = _strip_tags(loc_html)
            if len(divs) >= 3:
                age_days = _parse_age(_strip_tags(divs[2]))

        jobs.append({
            "title":    title,
            "company":  "",
            "location": location,
            "url":      url,
            "age_days": age_days,
        })

    return jobs


def fetch_page(query: str, page: int) -> str:
    params = urlencode({"search": query, "page": page})
    url = f"{BASE_URL}?{params}"
    if _debug:
        print(f"[aijobs] GET {url}", file=sys.stderr)
    req = Request(url, headers={
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; jobscanner/1.0)",
    })
    try:
        with urlopen(req, timeout=20) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except URLError as e:
        if _debug:
            print(f"[aijobs] fetch error: {e}", file=sys.stderr)
        return ""


def main():
    global _debug
    _debug = "--debug" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    cfg = _load_config()
    max_age = int(args[0]) if args else cfg.get("max_age_days", 5)

    queries = _derive_queries(cfg)
    if _debug:
        print(f"[aijobs] derived queries ({len(queries)}): {queries}", file=sys.stderr)
        print(f"[aijobs] max_age={max_age}", file=sys.stderr)

    seen_urls: set[str] = set()
    all_jobs: list[dict] = []

    for query in queries:
        for page in range(1, MAX_PAGES + 1):
            html = fetch_page(query, page)
            if not html:
                break

            jobs = _parse_jobs(html)
            if not jobs:
                if _debug:
                    print(f"[aijobs] {query!r} page {page}: no results — stopping", file=sys.stderr)
                break

            new_jobs = [j for j in jobs if j["url"] not in seen_urls]
            for j in new_jobs:
                seen_urls.add(j["url"])

            if not new_jobs:
                if _debug:
                    print(f"[aijobs] {query!r}: page {page}: no new results — stopping", file=sys.stderr)
                break

            ages = [j["age_days"] for j in new_jobs if j["age_days"] is not None]
            age_range = f"{min(ages)}–{max(ages)}d" if ages else "?"
            print(f"[aijobs] {query!r}: page {page} — {len(new_jobs)} new jobs ({age_range})", file=sys.stderr, flush=True)

            all_jobs.extend(new_jobs)

            # Stop early if oldest job on this page exceeds max_age (sorted newest first)
            if ages and min(ages) > max_age:
                if _debug:
                    print(f"[aijobs] oldest job {min(ages)}d > {max_age}d — stopping early", file=sys.stderr)
                break

    print(json.dumps(all_jobs), flush=True)


if __name__ == "__main__":
    main()