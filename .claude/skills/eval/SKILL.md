# /eval — Score Pending Jobs

Invoked when the user types `/eval`.

---

## Setup

Read before starting:
1. `cv.md` — source of truth for skills and experience
2. `portals.yml` — extract `tech_stack.positive`, `tech_stack.negative`, `score_threshold`

---

## pipeline.md structure

`pipeline.md` has three sections — eval reads only `## Active`:

| Section | Contents |
|---------|----------|
| `## Active` | `pending` jobs awaiting eval; scored jobs above threshold |
| `## Unresolvable` | Jobs that could not be fetched — skipped by eval |
| `## Done` | Scored below threshold, dismissed (`[x]`), or duplicates |

**Eval never touches `## Unresolvable` or `## Done` entries** except to move lines into those sections.

---

## Pre-flight cleanup (before evaluating any job)

**Step A — Move dismissed jobs**
Read `## Active` in `pipeline.md`. For every line starting with `- [x]`:
- Move it to `## Done` immediately
- Do not evaluate it

Also move any `- [ ] unresolvable | ...` lines still sitting in `## Active` to `## Unresolvable`.

Write this to `pipeline.md` before doing anything else.

**Step B — Deduplicate**
Among the remaining `- [ ]` lines in `## Active`, group by **company + title** (case-insensitive, ignoring punctuation). Where the same company+title appears more than once:
- Keep the first occurrence (topmost line) — leave it as `- [ ]`
- Mark every subsequent occurrence as `- [x] duplicate | url | company | title` and move it to `## Done`

Write the deduplicated `## Active` to `pipeline.md` before starting evaluation. Print a one-line summary: `Removed N duplicates.` (omit if N = 0).

---

## Per-job loop — STRICTLY ONE AT A TIME

**CRITICAL: fetch one job, score it, write the result to pipeline.md, output the score to the user — then and only then move to the next job. Never fetch multiple JDs before writing results. Never batch.**

For each `- [ ] pending | url | company | title` line in `## Active` (ignore `## Unresolvable` entirely):

**Step 1 — Fetch**
WebFetch the URL. If it fails (login wall, 403, redirect to homepage):
- Remove the line from `## Active` and append to `## Unresolvable`: `- [ ] unresolvable | url | company | title — [reason]`
- Print to user: `⚠ Unresolvable: {company} — {reason}`
- Go to next job

**Step 2 — Score**
Apply the HR Reviewer rubric below to the fetched JD + cv.md.

**Step 3 — Write to pipeline.md immediately (do not wait)**

If score ≥ threshold:
```
- [ ] {score} | url | company | title — {one-line verdict}
```

If score < threshold:
```
- [x] {score} | url | company | title — {one-line verdict}
```
Move `[x]` lines to `## Done`.

**Step 4 — Print result to user immediately:**
```
{score} {company} | {title} — {one-line verdict}
```
For rejected jobs add: `Gap: {top gap}`

**Step 5 — Next job.** Do not summarise until all jobs are done.

---

## After all jobs

Print a summary table:

```
| Score | Company | Role | Verdict | Top gap |
|-------|---------|------|---------|---------|
| 4.2   | Faculty | Computer Vision Engineer | Proceed | none |
| 3.6   | Wayve   | Software Engineer        | Proceed | Docker not mentioned |
| 2.8   | IQVIA   | Junior Data Engineer      | Reject  | Requires 2yr+ experience |
```

Then: `→ Review ## Active in pipeline.md. Mark [x] after applying.`

---

## Scoring Rubric — HR Reviewer

You are a senior tech recruiter at the hiring company conducting a CV screen. Your only job is to decide: does this CV warrant a first-round interview for this specific role?

The resume's only goal is to get the candidate an interview. You will not see a cover letter, portfolio, or motivation statement — only the CV. You have under 10 seconds on first glance before deciding to read further.

### Before scoring

Extract from cv.md (already loaded):
- Career level: new grad / early career (0–2 yrs) / mid-level (3–5 yrs) / senior (6+ yrs)
- Years of experience (total, and in the most relevant domain)
- Core skills and technologies listed
- Any standout credentials: well-known employer, published research, notable open-source, patent, PhD

Extract from the JD:
- Minimum required YoE (if stated)
- Must-have technologies (labelled "required", "essential", "you must have")
- Nice-to-have technologies (labelled "preferred", "bonus", "desirable")
- Seniority level implied by title and requirements

### Stage 1 — ATS keyword scan (automated filter, before a human sees it)

Check whether the CV contains the exact terms the ATS would match against:
- Required tech keywords from the JD (exact strings: "PyTorch", not just "deep learning frameworks")
- Role-level keywords: "junior", "graduate", "entry-level" if the role targets that level

Flag any required keyword that is absent from the CV. These are keyword gaps — the candidate may have the skill but hasn't named it explicitly.

### Stage 2 — Hard disqualifiers (automatic reject, do not soften)

Reject immediately (score ≤ 1.5) if:
- JD states a minimum YoE (e.g. "3+ years required") and the candidate is provably below it
- JD requires a technology listed in `tech_stack.negative` as *essential* (not just preferred)
- JD requires a domain the candidate has zero exposure to (e.g. pure embedded firmware, COBOL)
- JD is senior/lead/staff and the candidate is new grad or early career with no exceptional signal

Do not penalise for nice-to-haves, preferred skills, or soft requirements.

### Stage 3 — First-glance priorities (recruiter scan, in order)

Read these five things first, in this order:

1. **Years of experience** — does it meet or come close to the JD's stated minimum?
2. **Relevant technologies** — do the JD's required tools appear explicitly in the CV?
3. **Quantified impact** — does work experience show measurable outcomes (not just duties)?
4. **Work authorisation** — any visa flags for the role's location?
5. **Standout credential** — well-known employer, research publication, notable open-source project

### Stage 4 — Section quality by career level

#### New grad / early career (0–2 yrs)
Evaluate in this order:
- Work experience or internships — even tangential ones count
- Projects — do they include GitHub links? Is scope and outcome described?
- Education — graduation date, relevant coursework, final year project
- Technologies listed — does the list match the JD's stack?

#### Mid-level (3–5 yrs)
Evaluate in this order:
- Work experience — consistent progression, measurable impact, relevant domain
- Technologies — appear on page one, match JD requirements
- Education — present but condensed
- Open source / side projects — bonus signal

#### Senior (6+ yrs)
Evaluate in this order:
- Summary / headline — tailored signal, not generic
- Work experience — scope, influence, technical depth
- Technologies
- Publications, patents, talks, notable open source
- Education — degree only, page two

### Scoring scale (0.0–5.0)

| Score | Meaning |
|-------|---------|
| 4.5–5.0 | Strong match — proceed to interview. Skills align, seniority fits, no blockers. |
| 3.5–4.4 | Good match — proceed. Most criteria met, one or two minor gaps. |
| 2.5–3.4 | Borderline — marginal. Notable skill or seniority gap; only proceed if pipeline is thin. |
| 1.5–2.4 | Weak — do not proceed. Significant mismatch in skills, level, or domain. |
| 0.0–1.4 | Reject — hard disqualifier triggered (YoE, required tech absent, wrong domain). |

Score to one decimal place. Do not round up to avoid a hard disqualifier.

### Output per job

After scoring, produce:

```
Score: {X.X}
Verdict: Proceed / Reject
One-line reason: {what most determined the score}
Gaps: {up to 2 keyword or skill gaps from the JD that are absent from the CV — only if material}
Fix: {one specific CV edit that would improve this score, if score < 4.0}
```

The `Fix` line is for the candidate only — it identifies what to add or reword in the CV before applying. Omit if score ≥ 4.0 or if no realistic fix exists.

Use this output to write the pipeline.md line and populate the summary table.