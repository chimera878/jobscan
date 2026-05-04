# jobscan

## Data Contract (CRITICAL)

**User Layer — never auto-overwritten. These files belong to you:**
- `cv.md` — your CV, source of truth for all scoring
- `portals.yml` — your search config (keywords, filters, tech stack, queries)
- `pipeline.md` — your job inbox (Claude updates status markers only, never deletes sections)
- `scan-history.tsv` — dedup log (append-only, never truncated)

**System Layer — scripts and templates, safe to update:**
- `scan.mjs`, `adzuna_scan.py`, `aijobs_scan.py` — scanner scripts
- `portals.example.yml` — template only, never used at runtime
- `package.json`, `.gitignore`

**THE RULE:** Never overwrite `cv.md` or `portals.yml` without explicit user instruction. When writing to `pipeline.md`, only append or update status markers — never delete existing content or restructure sections without being asked.

---

## What is jobscan

jobscan supports your immediate job search. It is not a career planning tool — it does not answer questions like "what should I do with my life?" or give long-term career advice.

It gathers job postings from multiple sources, filters them against your skills and constraints, and scores alignment with your CV — so you spend time on roles worth applying to, not browsing.

The system has two layers:

- **Discovery** (`node scan.mjs`) — hits job board APIs and scrapers. Zero Claude tokens. No AI involved.
- **Evaluation** (`/eval`) — Claude reads each JD, compares against your CV, scores fit. No applications are submitted. You make that call.

---

## Main Files

| File | Purpose |
|------|---------|
| `cv.md` | Your CV in markdown — the only thing Claude scores against |
| `portals.yml` | All search config: keywords, seniority, location, tech stack, queries, threshold |
| `portals.example.yml` | Blank template — copy to portals.yml to start |
| `pipeline.md` | Job inbox: `## Active` (score ≥ threshold), `## Unresolvable`, `## Done` |
| `scan-history.tsv` | Dedup log — prevents same URL appearing twice across scans |
| `scan.mjs` | Main scanner — queries ATS APIs, Adzuna, AI Jobs, and Reed; writes new jobs to pipeline.md |
| `adzuna_scan.py` | Adzuna API client — free UK job aggregator (~1M listings), called by scan.mjs |
| `aijobs_scan.py` | aijobs.net HTML scraper — queries auto-derived from keyword_filter, no API key needed |
| `package.json` | Node.js dependencies (js-yaml) and npm scripts |
| `.gitignore` | Excludes personal files from git (cv.md, portals.yml, cookies, history) |

---

## Commands

| Command | What it does |
|---------|-------------|
| `node scan.mjs` | Scan all sources, append new jobs to pipeline.md in real-time |
| `node scan.mjs --dry-run` | Preview results without writing anything |
| `node scan.mjs --verbose` | Show every filtered job with the reason it was excluded |
| `node scan.mjs --company Wayve` | Scan a single tracked company only |
| `/eval` | Score all pending jobs in pipeline.md against your CV |
| `/init` | Run the setup — configures cv.md, portals.yml, and query calibration |
| `/scan` | WebSearch scan for custom ATS companies (`scan_method: websearch`) — writes to pipeline.md |

---

## Skills

Type `/init` to run the setup (configures cv.md, portals.yml, query calibration).
Type `/eval` to score pending jobs in pipeline.md against your CV.
Type `/scan` to scan jobs in tracked companies listed in portals.yml, and search jobs listed publically in Greenhouse / Ashby / Lever.

These skills load on demand — they are not loaded in every session.
