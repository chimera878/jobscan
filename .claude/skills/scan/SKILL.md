# /scan — WebSearch company scan

Invoked when the user types `/scan`.

Finds new jobs via WebSearch for tracked companies stored with `scan_method: websearch` in
`portals.yml`, and appends them to `pipeline.md`.

Runs independently from `node scan.mjs` (which polls per-company ATS JSON APIs at zero token cost).
Both write to the same `pipeline.md`; `/eval` scores everything not yet marked done.

---

## Workflow

### Step 1 — Read config

Use the Read tool on `portals.yml`. Extract:
- `tracked_companies` where `scan_method: websearch` and `enabled: true` → these have a `scan_query` field
- `keyword_filter.positive`, `seniority_filter.exclude`, `domain_filter.exclude`

### Step 2 — Load seen URLs

Use the Read tool on `scan-history.tsv` (column 0 = url) and `pipeline.md` (all `https://`
URLs in existing lines). Build a seen-URL set in memory.

### Step 3 — Run WebSearch queries

For each tracked company with `scan_method: websearch`, run its `scan_query` via WebSearch. Extract:
- `title`: everything before the first ` @ `, ` | `, ` — `, or ` at ` in the result title
- `url`: the result URL
- `company`: the `name` field from portals.yml (do not parse from title)

**Filtering — apply in memory for all results, do not write scripts:**
1. At least one `keyword_filter.positive` term must appear in the title (case-insensitive)
2. No `seniority_filter.exclude` term may appear in the title
3. No `domain_filter.exclude` term may appear in the title
4. URL must not already be in the seen set

Collect all passing jobs (those that survived all 4 filters) in memory.
**Once all queries are done, stop. Do not re-read files, do not run more searches.
Proceed immediately to Step 4.**

### Step 4 — Append to pipeline.md

**Write only jobs that passed all filters in Step 3. Do this immediately — no additional processing.**

Use the Edit tool once to insert all passing jobs under `## Active` in pipeline.md.
If there are no passing jobs, skip to Step 5 and print the summary with 0 new jobs.

```
- [ ] pending | {url} | {company} | {title}
```

Do not write Python scripts. Do not run Bash. Do not run `node scan.mjs`. Use only the Edit tool for file writes.

### Step 5 — Print summary

```
WebSearch scan — {YYYY-MM-DD}
Company queries: {N}
New jobs added: {N}
→ Run /eval to score new jobs.
```