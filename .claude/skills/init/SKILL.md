# /init — jobscan Setup Wizard

Invoked when the user types `/init`.

---

## Session-start silent check

At the start of every session, silently check:
1. Does `cv.md` exist?
2. Does `portals.yml` exist (not just `portals.example.yml`)?

**If both exist** → say nothing. Proceed normally.

**If either is missing** → enter onboarding below. Do not proceed with any other task until complete.

**`/init` explicit invocation**: always run the full question flow below, regardless of whether files exist. Use it to reconfigure your search targets.

**Re-run shortcut**: if `cv.md` and `portals.yml` both already exist and the user runs `/init` explicitly, ask:
> Your config is already set up. Do you want to:
> 1. Reconfigure everything (Q1–Q6)
> 2. Just refresh your company watchlist (Q6 only)

If they choose option 2, skip to **Step 3: Company watchlist** below.

---

## Step 1: CV

**If `cv.md` is missing** → stop and inform the user: "`cv.md` is missing — please add it to the project directory before continuing. See the Quick Start in README.md for instructions."
**If `cv.md` already exists** → read it silently. Never overwrite cv.md.

Ask the following questions **one at a time**. Wait for the answer before asking the next.

---

Welcome. I'll configure your job scanner in 6 steps.

**1) What roles are you targeting?**
Describe the types of roles or work you're interested in. This can be specific titles, domains, or a general direction.
— "Backend engineer"
— "Python-focused roles"
— "Data roles at startups"
— "Machine learning or computer vision, leaning applied over research"

**2) What is your experience level?**
This calibrates seniority filtering.
— "Recent graduate"
— "1–2 years"
— "Mid-level"
— "Senior"

**3) What are your core skills and strengths?**
These are used to score role fit and prioritise relevant matches.
— "Python, SQL, AWS"
— "Computer vision, PyTorch, OpenCV"

**4) Are there any constraints or deal-breakers?**
This filters out roles that aren't a fit before they reach you.
You can specify:
— Technologies you don't use or plan to use
— Domains or role types you want to exclude
— Work styles or environments to avoid

**5) Where are you based, and what is your location flexibility?**
— "London, open to remote"
— "UK only, no relocation"
— "Open across Europe"

**6) Which companies are you most interested in working at?**
I'll check which ones I can track directly via their job board and add them to your watchlist.
You can:
— Name specific companies: "Wayve, Deepmind, Improbable, Monzo"
— Describe a category: "UK AI startups", "London fintech scaleups"
— Say "suggest some" and I'll generate a list based on your profile
— Say "skip" to set this up later

Cap: I'll resolve up to **20 companies** per run. You can re-run `/init` to add more later.

---

### Answer validation

After each answer, check whether it is relevant and specific enough to use.

**Off-topic** (e.g. "my favourite food is burger", "I don't know"):
> That doesn't quite answer the question — I need [restate what's needed]. For example: [one concrete example]. Try again?

**Too vague** (e.g. "anything", "whatever pays", "I don't mind"):
> That's a starting point — but I need a bit more to configure the scanner. [One specific follow-up probe]. Even a rough direction helps.

Do not loop more than twice on the same question. After two failed attempts, use a sensible default, state the assumption, and move on:
> I'll use [default] as a starting point — you can edit portals.yml directly later if needed.

---

## Step 2: portals.yml (if missing)

Use `portals.example.yml` as the base structure. Write the following fields directly from the init answers:

| Field | Source |
|-------|--------|
| `tech_stack.positive` | Q3 exact terms |
| `tech_stack.negative` | Q4 tech exclusions |
| `domain_filter.exclude` | Q4 domain exclusions (e.g. "no frontend" → Frontend, Front-end, Full Stack) |
| `location_filter.allow/block` | Q5 |
| `adzuna.app_id` / `adzuna.app_key` | From Adzuna API portal (developer.adzuna.com) |
| `score_threshold` | Default `3.5` |

Then run **Query Calibration** (below) to generate `seniority_filter`, `keyword_filter`, `reed_queries`, and `adzuna_queries`.

Confirm when done:
> Setup complete. Run `node scan.mjs` to discover jobs, then `/eval` to score them.

---

## Step 3: Company watchlist

*(Runs after Q7. If user said "skip", print: "You can add companies later by re-running `/init` and choosing option 2." and stop.)*

### 3a — Build the candidate list

If the user named companies → use their list as-is (up to 20).

If the user described a category or said "suggest" → generate up to 20 company names using:
- Q1 (target domain) + Q5 (location) + cv.md signals (if loaded)
- UK market knowledge: aim for a mix of well-known names and growth-stage companies
- Do not bias toward Greenhouse/Ashby/Lever — the search-first approach handles any ATS

Print the candidate list before resolving:
```
Resolving {N} companies — this may take a moment...
```

### 3b — Per-company resolution

For each company on the candidate list:

**Step i — WebSearch discovery**

Run:
```
WebSearch: "{company name}" jobs uk
```

Inspect the first 3–5 results. Skip aggregators (linkedin.com, indeed.com, glassdoor.com,
reed.co.uk, totaljobs.com, otta.com). Take the first result URL from the company's own
domain — that becomes `careers_url`.

If the first non-aggregator result is already on a known ATS subdomain
(greenhouse.io, ashbyhq.com, lever.co)
→ that URL is the `careers_url`. Proceed to Step ii with it directly.

If no non-aggregator result found in the first 5 results → mark as unresolvable.

**Step ii — ATS classification**

From the `careers_url` found in Step i, classify by URL pattern:

| URL pattern | ATS | Scanned by |
|-------------|-----|-----------|
| `job-boards*.greenhouse.io/{slug}` | Greenhouse | `node scan.mjs` |
| `jobs.ashbyhq.com/{slug}` | Ashby | `node scan.mjs` |
| `jobs.lever.co/{slug}` | Lever | `node scan.mjs` |
| anything else | Custom | `/scan` skill |

**Step iii — Write to portals.yml**

For **supported ATS** companies (Greenhouse/Ashby/Lever):
```yaml
  - name: {Company Name}
    careers_url: {careers_url}
    enabled: true
```
`scan.mjs` auto-detects the correct JSON API from the URL pattern.

For **custom ATS** companies:
```yaml
  - name: {Company Name}
    careers_url: {careers_url}
    scan_method: websearch
    scan_query: 'site:{careers_domain} "{role_kw_1}" OR "{role_kw_2}" UK OR London'
    enabled: true
```
Derive `scan_query` from Q1 role keywords + Q5 location. Use the same terms as
`keyword_filter.positive`, each quoted, joined with OR, location appended.

Append all entries to the `tracked_companies` section of `portals.yml`. Do not remove
or overwrite existing entries.

### 3c — Print resolution summary

```
Company watchlist:

  API-trackable ({N}) — polled by node scan.mjs (Greenhouse/Ashby/Lever only):
    ✓ Wayve       → https://jobs.lever.co/wayve            [Lever]
    ✓ Monzo       → https://job-boards.greenhouse.io/monzo  [Greenhouse]

  WebSearch-only ({M}) — polled by /scan:
    ○ Google      → https://careers.google.com/jobs/results [custom]
    ○ Bloomberg   → https://careers.bloomberg.com/job/search [custom]
    ○ Revolut     → https://jobs.revolut.com                [custom]

  Unresolvable ({K}):
    ? Tibra       — no company careers page found in search results

→ Run node scan.mjs to poll Greenhouse/Ashby/Lever tracked companies.
→ Run /scan to search ALL companies on those platforms + custom ATS companies.
→ Re-run /init to add more companies later.
```

---

## Query Calibration

Runs automatically at the end of `/init` after portals.yml is written. Uses Q1–Q5 answers + cv.md to generate an optimal, frequency-ranked search vocabulary for the job market the user is targeting.

Inputs available at this point: Q1 (target roles), Q2 (experience level), Q3 (skills), Q4 (constraints), Q5 (location), cv.md (full career history).

### Stage 1 — Career stage analysis

Read cv.md and Q2 to determine the user's tier:

| Tier | Labels used by UK employers | Signals |
|------|----------------------------|---------|
| Graduate | graduate, entry level | 0–12 months paid exp, recent degree |
| Early career | junior | 1–3 years |
| Mid | (unlabelled), mid-level | 3–6 years |
| Senior | senior, sr | 6–10 years |
| Staff / Lead | lead, staff, principal | 10+ years |
| Executive | head of, director, VP | Management track |

Signals to extract from cv.md:
- **Graduation date** — recent (< 18 months) → graduate tier
- **Total paid YoE** — count months; internships count as 0.5
- **Degree level** — MSc/PhD shifts expectations up within a tier
- **Publications** — if present, unlock research-track titles (Research Engineer, Applied Scientist)
- **Employer prestige** — FAANG/top-tier lab → can apply to roles one tier above

### Stage 2 — Seniority filter

Generate `seniority_filter.exclude` from the determined tier. Always exclude Apprenticeship regardless of tier (vocational route, no degree required — different track).

- **Graduate**: Senior, Sr., Sr , Lead, Staff, Principal, Manager, Director, VP , Head of, Chief, Vice President, Apprenticeship, Research Scientist, Research Engineer *(unless cv.md shows publications)*
- **Early career**: Senior, Sr., Sr , Lead, Staff, Principal, Manager, Director, VP , Head of, Chief, Vice President, Apprenticeship
- **Mid**: Staff, Principal, Manager, Director, VP , Head of, Chief, Apprenticeship
- **Senior**: Principal, Head of, Director, VP , Chief, Apprenticeship

### Stage 3 — Role title variants

Using Q1 (target domain) + cv.md tech stack + UK market knowledge, generate a **comprehensive, non-overlapping** set of role title stems, ranked by UK posting frequency.

**Frequency principles:**
- Generic titles ("Software Engineer") appear far more than specialist ones ("Computer Vision Engineer")
- "Graduate X" is a distinct UK employer label — not interchangeable with "Junior X"
- "AI Engineer" typically requires 2+ years in practice — deprioritise at grad/junior level
- "Research Scientist" / "Applied Scientist" require publications — omit unless cv.md shows them
- "Computer Vision Engineer" is rare in the UK market — low priority

**Tier structure (example for Python/ML grad):**

Tier 1 — High frequency: `graduate software engineer`, `graduate software developer`, `graduate developer`, `junior software engineer`, `junior software developer`

Tier 2 — Medium frequency: `graduate python developer`, `junior python developer`, `graduate data engineer`, `junior data engineer`, `graduate machine learning`, `junior machine learning engineer`

Tier 3 — Low frequency (use only if query slots remain): `machine learning engineer` (unlabelled — often mid in practice), `AI engineer`, `data scientist`

Do not include: `computer vision engineer` (rare UK), `research scientist`, `applied scientist` (require publications unless cv.md shows them).

### Stage 4 — Query selection

Rules:
- Max **8 queries per source** (Reed and Adzuna independently)
- **No overlapping queries** — use the shorter form that returns a superset (e.g. "junior software engineer" not "junior software engineer python")
- Fill slots with Tier 1 first, then Tier 2, then Tier 3
- Reed and Adzuna may have slightly different sets — Reed benefits from exact phrases; Adzuna benefits from broader keyword matching

Derive `location` per query from Q5: city-fixed → city name; open nationally → country name; open to remote → add one `location: "Remote"` query per domain

### Stage 5 — keyword_filter sync

Derive `keyword_filter.positive` as the union of all title stems across all tiers:
- Extract the role noun from each query: "graduate software engineer" → add "software engineer" and "graduate"
- Add standalone seniority labels: "graduate", "junior" (catch titles like "Graduate Developer" with no tech keyword)
- Add domain keywords directly: "machine learning", "data engineer", "computer vision"
- Do not add "developer" as a standalone term — too broad without a domain qualifier

### Stage 6 — Write to portals.yml

Overwrite only:
- `seniority_filter.exclude`
- `keyword_filter.positive`
- `reed_queries`
- `adzuna_queries`

Preserve unchanged: `tech_stack`, `location_filter`, `domain_filter`, `adzuna.app_id`, `adzuna.app_key`, `score_threshold`, `reed_api_key`, `tracked_companies`.

**NEVER add `scan_method: websearch` to a company entry that has a Greenhouse/Ashby/Lever URL.**
`scan_method: websearch` is only for custom ATS companies. ATS-hosted companies are handled by
`node scan.mjs` at zero token cost.

Print:
```
Calibration complete.
  Tier: {tier} ({YoE signal})
  Role variants: {n} titles across {n} tiers
  Reed queries: {n} | Adzuna queries: {n}
  Excluded: {comma-separated seniority labels}

→ Run node scan.mjs for zero-token API scan.
→ Run /scan for WebSearch platform + company scan.
```