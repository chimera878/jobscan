#!/usr/bin/env node

/**
 * scan.mjs — Zero-token job scanner
 *
 * Sources (no Claude tokens — pure HTTP):
 *   1. ATS APIs  — Greenhouse, Ashby, Lever (tracked_companies in portals.yml)
 *   2. Adzuna    — UK job aggregator API (free key in portals.yml)
 *   3. AI Jobs   — aijobs.net HTML scraper, queries auto-derived from keyword_filter
 *   4. Reed UK   — direct REST API (free key in portals.yml)
 *
 * Usage:
 *   node scan.mjs              # scan all sources
 *   node scan.mjs --dry-run    # preview without writing files
 *   node scan.mjs --verbose    # show every filtered job
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import yaml from 'js-yaml';

const PORTALS_PATH    = 'portals.yml';
const SCAN_HISTORY    = 'scan-history.tsv';
const PIPELINE        = 'pipeline.md';
const CONCURRENCY     = 10;
const FETCH_TIMEOUT   = 10_000;

// ── ATS API detection ────────────────────────────────────────────────

function detectApi(company) {
  if (company.scan_method === 'websearch') return null;

  if (company.api?.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }
  const url = company.careers_url || '';

  const ashby = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashby) return {
    type: 'ashby',
    url: `https://api.ashbyhq.com/posting-api/job-board/${ashby[1]}?includeCompensation=true`,
  };

  const lever = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (lever) return {
    type: 'lever',
    url: `https://api.lever.co/v0/postings/${lever[1]}`,
  };

  const gh = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (gh && !company.api) return {
    type: 'greenhouse',
    url: `https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs`,
  };

  return null;
}

// ── Date helpers ─────────────────────────────────────────────────────

function ageInDays(date) {
  if (!date || isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}
const fromIso = s => { const d = new Date(s); return isNaN(d.getTime()) ? null : d; };
const fromMs  = s => { const d = new Date(Number(s)); return isNaN(d.getTime()) ? null : d; };

// ── ATS parsers ──────────────────────────────────────────────────────

function parseGreenhouse(json, name) {
  return (json.jobs || []).map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: name,
    location: j.location?.name || '',
    ageDays: ageInDays(fromIso(j.updated_at)),
  }));
}

function parseAshby(json, name) {
  return (json.jobs || []).map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: name,
    location: j.location || '',
    ageDays: ageInDays(fromIso(j.publishedDate || j.updatedAt || j.createdAt)),
  }));
}

function parseLever(json, name) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: name,
    location: j.categories?.location || '',
    ageDays: ageInDays(fromMs(j.createdAt)),
  }));
}

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever };

// ── Adzuna Python sidecar ────────────────────────────────────────────

function fetchAdzunaPython(query, location, maxAge) {
  return new Promise(resolve => {
    const child = spawn(
      process.env.PYTHON_BIN || 'python',
      ['adzuna_scan.py', query, location, String(maxAge)],
      { cwd: process.cwd() }
    );
    child.stderr.on('data', d => process.stderr.write(d));
    let out = '';
    child.stdout.on('data', d => { out += d; });
    const timer = setTimeout(() => { child.kill(); resolve([]); }, 300_000);
    child.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(out)); } catch { resolve([]); } });
    child.on('error', () => { clearTimeout(timer); resolve([]); });
  });
}

// ── AI Jobs scraper ──────────────────────────────────────────────────

function fetchAijobsPython(maxAge) {
  return new Promise(resolve => {
    const child = spawn(
      process.env.PYTHON_BIN || 'python',
      ['aijobs_scan.py', String(maxAge)],
      { cwd: process.cwd() }
    );
    child.stderr.on('data', d => process.stderr.write(d));
    let out = '';
    child.stdout.on('data', d => { out += d; });
    const timer = setTimeout(() => { child.kill(); resolve([]); }, 300_000);
    child.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(out)); } catch { resolve([]); } });
    child.on('error', () => { clearTimeout(timer); resolve([]); });
  });
}

// ── Reed API ─────────────────────────────────────────────────────────

const AGENCY_NAME_RE = [/\brecruitment\b/i, /\brecruiting\b/i, /\bstaffing\b/i, /\bheadhunt/i];
const AGENCY_DESC_RE = [/\bour client\b/i, /\bmy client\b/i, /\bon behalf of (our|a|the)\b/i];

function isAgency(name, desc = '') {
  return AGENCY_NAME_RE.some(r => r.test(name)) || AGENCY_DESC_RE.some(r => r.test(desc));
}

function parseReedDate(s) {
  if (!s) return null;
  const [d, m, y] = s.split('/');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return isNaN(date.getTime()) ? null : date;
}

async function fetchReed(query, location, apiKey) {
  const params = new URLSearchParams({ keywords: query, locationName: location, distanceFromLocation: 25, resultsToTake: 100 });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(`https://www.reed.co.uk/api/1.0/search?${params}`, {
      signal: ctrl.signal,
      headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json.results || [])
      .filter(j => !isAgency(j.employerName || '', j.jobDescription || ''))
      .map(j => ({
        title: j.jobTitle || '',
        url: j.jobUrl || `https://www.reed.co.uk/jobs/${j.jobId}`,
        company: j.employerName || '',
        location: j.locationName || '',
        ageDays: ageInDays(parseReedDate(j.date)),
      }));
  } finally { clearTimeout(timer); }
}

// ── Fetch helper ─────────────────────────────────────────────────────

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

// ── Filters ──────────────────────────────────────────────────────────

function buildKeywordFilter(keywords) {
  // At least one keyword must appear in the job title
  const terms = (keywords || []).map(k => k.toLowerCase());
  return title => {
    if (terms.length === 0) return true;
    const lower = title.toLowerCase();
    return terms.some(k => lower.includes(k));
  };
}

function buildSeniorityFilter(filter) {
  // Hard exclude — rejects if any exclude keyword appears in title
  const exclude = (filter?.exclude || []).map(k => k.toLowerCase());
  return title => {
    const lower = title.toLowerCase();
    return !exclude.some(k => lower.includes(k));
  };
}

function buildDomainFilter(filter) {
  // Hard exclude — rejects unwanted role types (frontend, embedded, etc.)
  const exclude = (filter?.exclude || []).map(k => k.toLowerCase());
  return title => {
    const lower = title.toLowerCase();
    return !exclude.some(k => lower.includes(k));
  };
}

function buildLocationFilter(filter) {
  if (!filter) return () => true;
  const allow = (filter.allow || []).map(k => k.toLowerCase());
  const block = (filter.block || []).map(k => k.toLowerCase());
  return location => {
    if (!location) return true;
    const lower = location.toLowerCase();
    if (block.some(k => lower.includes(k))) return false;
    if (allow.length === 0) return true;
    return allow.some(k => lower.includes(k));
  };
}

// ── Dedup ─────────────────────────────────────────────────────────────

// Normalize Adzuna URLs for dedup: strip query params so details/{id}?utm_...
// and details/{id} are treated as the same job.
function dedupeKey(url) {
  if (url.includes('adzuna.')) return url.split('?')[0];
  return url;
}

function loadSeenState() {
  const seenUrls   = new Set();
  const seenTitles = new Set(); // "company|title" keys — loaded from pipeline to block re-spam

  if (existsSync(SCAN_HISTORY)) {
    for (const line of readFileSync(SCAN_HISTORY, 'utf-8').split('\n').slice(1)) {
      const url = line.split('\t')[0];
      if (url) seenUrls.add(dedupeKey(url));
    }
  }

  if (existsSync(PIPELINE)) {
    const pText = readFileSync(PIPELINE, 'utf-8');
    for (const match of pText.matchAll(/https?:\/\/[^\s|)\]]+/g)) {
      seenUrls.add(dedupeKey(match[0]));
    }
    // Build company|title keys from existing pipeline entries to block re-spam
    for (const line of pText.split('\n')) {
      if (!line.startsWith('- [')) continue;
      const urlMatch = line.match(/https?:\/\/[^\s|]+/);
      if (!urlMatch) continue;
      const rest = line.slice(line.indexOf(urlMatch[0]) + urlMatch[0].length);
      const parts = rest.split(' | ');
      if (parts.length >= 3) {
        const company = parts[1].trim().toLowerCase();
        const title   = parts[2].split(' — ')[0].trim().toLowerCase();
        if (company || title) seenTitles.add(`${company}|${title}`);
      }
    }
  }

  return { seenUrls, seenTitles };
}

// ── Pipeline writer (real-time, one job at a time) ───────────────────

function appendJobToPipeline(offer) {
  const line = `- [ ] pending | ${offer.url} | ${offer.company} | ${offer.title}`;
  let text = existsSync(PIPELINE) ? readFileSync(PIPELINE, 'utf-8') : '# Job Pipeline\n';

  const marker = '## Active';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    text = `# Job Pipeline\n\n## Active\n${line}\n\n` + text;
  } else {
    const after = idx + marker.length;
    const next = text.indexOf('\n## ', after);
    const insertAt = next === -1 ? text.length : next;
    text = text.slice(0, insertAt) + '\n' + line + text.slice(insertAt);
  }

  writeFileSync(PIPELINE, text, 'utf-8');
}

// ── History writer (real-time, one job at a time) ────────────────────

function appendJobToHistory(offer, date) {
  if (!existsSync(SCAN_HISTORY)) {
    writeFileSync(SCAN_HISTORY, 'url\tfirst_seen\tsource\ttitle\tcompany\n', 'utf-8');
  }
  appendFileSync(SCAN_HISTORY,
    `${offer.url}\t${date}\t${offer.source}\t${offer.title}\t${offer.company}\n`,
    'utf-8');
}

// ── Pipeline cleanup ──────────────────────────────────────────────────

function cleanDoneSection() {
  if (!existsSync(PIPELINE)) return;
  let text = readFileSync(PIPELINE, 'utf-8');

  // Move manually-dismissed [x] lines from ## Active to ## Done
  const activeMarker = '## Active';
  const activeIdx = text.indexOf(activeMarker);
  if (activeIdx !== -1) {
    const activeAfter = activeIdx + activeMarker.length;
    const activeEnd = (() => { const n = text.indexOf('\n## ', activeAfter); return n === -1 ? text.length : n; })();
    const activeLines = text.slice(activeAfter, activeEnd).split('\n');
    const dismissed = activeLines.filter(l => l.startsWith('- [x]'));
    const kept      = activeLines.filter(l => !l.startsWith('- [x]'));
    if (dismissed.length > 0) {
      text = text.slice(0, activeAfter) + kept.join('\n') + text.slice(activeEnd);
      // Append dismissed lines to ## Done
      const doneMarker = '## Done';
      const doneIdx = text.indexOf(doneMarker);
      if (doneIdx !== -1) {
        const doneAfter = doneIdx + doneMarker.length;
        text = text.slice(0, doneAfter) + '\n' + dismissed.join('\n') + text.slice(doneAfter);
      }
    }
  }

  // Remove all [x] lines from ## Done (discard)
  const doneMarker = '## Done';
  const doneIdx = text.indexOf(doneMarker);
  if (doneIdx === -1) { writeFileSync(PIPELINE, text, 'utf-8'); return; }
  const doneAfter = doneIdx + doneMarker.length;
  const doneEnd = (() => { const n = text.indexOf('\n## ', doneAfter); return n === -1 ? text.length : n; })();
  const cleaned = text.slice(doneAfter, doneEnd)
    .split('\n')
    .filter(line => !line.startsWith('- [x]'))
    .join('\n');
  writeFileSync(PIPELINE, text.slice(0, doneAfter) + cleaned + text.slice(doneEnd), 'utf-8');
}

// ── Parallel fetch ────────────────────────────────────────────────────

async function parallelFetch(tasks, limit) {
  let i = 0;
  async function next() {
    while (i < tasks.length) await tasks[i++]();
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => next()));
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const args     = process.argv.slice(2);
  const dryRun   = args.includes('--dry-run');
  const verbose  = args.includes('--verbose');
  const cmpIdx   = args.indexOf('--company');
  const filterCo = cmpIdx !== -1 ? args[cmpIdx + 1]?.toLowerCase() : null;

  if (!existsSync(PORTALS_PATH)) {
    console.error('portals.yml not found. Copy portals.example.yml → portals.yml and fill in your details.');
    process.exit(1);
  }

  const cfg           = yaml.load(readFileSync(PORTALS_PATH, 'utf-8'));
  const maxAgeDays    = cfg.max_age_days ?? 5;
  const reedApiKey    = cfg.reed_api_key || '';
  const adzunaQueries = (cfg.adzuna_queries || []).filter(q => q.enabled !== false);
  const reedQueries   = (cfg.reed_queries   || []).filter(q => q.enabled !== false);
  const companies     = cfg.tracked_companies || [];

  const keywordFilter  = buildKeywordFilter(cfg.keyword_filter?.positive);
  const seniorityFilter = buildSeniorityFilter(cfg.seniority_filter);
  const domainFilter   = buildDomainFilter(cfg.domain_filter);
  const locationFilter = buildLocationFilter(cfg.location_filter);

  const targets = companies
    .filter(c => c.enabled !== false)
    .filter(c => !filterCo || c.name.toLowerCase().includes(filterCo))
    .map(c => ({ ...c, _api: detectApi(c) }))
    .filter(c => c._api !== null);

  const sources = [`${targets.length} ATS companies`];
  if (adzunaQueries.length && existsSync('adzuna_scan.py')) sources.push(`${adzunaQueries.length} Adzuna queries`);
  if (existsSync('aijobs_scan.py')) sources.push('AI Jobs (auto-queries)');
  if (reedApiKey && reedQueries.length) sources.push(`${reedQueries.length} Reed queries`);

  console.log(`Sources: ${sources.join(' + ')}`);
  if (dryRun) console.log('(dry run — nothing will be written)\n');

  const date = new Date().toISOString().slice(0, 10);
  const { seenUrls, seenTitles } = loadSeenState();

  let totalFound = 0, totalFiltered = 0, totalStale = 0, totalDupes = 0, totalNew = 0;
  const errors = [];

  if (!dryRun) cleanDoneSection();

  function processJob(job, source) {
    totalFound++;
    if (!job.url) return;
    if (!keywordFilter(job.title))   { if (verbose) console.log(`  [keyword]   ${job.company} | ${job.title}`); totalFiltered++; return; }
    if (!seniorityFilter(job.title)) { if (verbose) console.log(`  [seniority] ${job.company} | ${job.title}`); totalFiltered++; return; }
    if (!domainFilter(job.title))    { if (verbose) console.log(`  [domain]    ${job.company} | ${job.title}`); totalFiltered++; return; }
    if (!locationFilter(job.location)) { if (verbose) console.log(`  [location]  ${job.company} | ${job.title} | ${job.location}`); totalFiltered++; return; }
    if (job.ageDays !== null && job.ageDays > maxAgeDays) { totalStale++; return; }
    if (seenUrls.has(dedupeKey(job.url))) { totalDupes++; return; }

    // Company+title dedup — blocks same-company spam (e.g. Turing posting 20 identical titles)
    const titleKey = `${(job.company || '').toLowerCase().trim()}|${job.title.toLowerCase().trim()}`;
    if (titleKey !== '|' && seenTitles.has(titleKey)) {
      if (verbose) console.log(`  [title-dup] ${job.company} | ${job.title}`);
      totalDupes++;
      return;
    }
    if (titleKey !== '|') seenTitles.add(titleKey);

    seenUrls.add(dedupeKey(job.url));
    const offer = { ...job, source };

    if (!dryRun) {
      appendJobToPipeline(offer);
      appendJobToHistory(offer, date);
    }

    totalNew++;
    const age = job.ageDays != null ? `${job.ageDays}d` : '?d';
    console.log(`  + [${source}] ${job.company} | ${job.title} | ${job.location || 'N/A'} | ${age}`);
  }

  // ATS APIs
  await parallelFetch(targets.map(company => async () => {
    const api = company._api;
    const { type, url } = api;
    try {
      const json = await fetchJson(url);
      const jobs = PARSERS[type](json, company.name);
      for (const job of jobs) processJob(job, type);
    } catch (err) {
      errors.push({ src: company.name, msg: err.message });
    }
  }), CONCURRENCY);

  // Adzuna
  if (adzunaQueries.length && !filterCo && existsSync('adzuna_scan.py')) {
    let total = 0;
    for (const q of adzunaQueries) {
      try {
        const jobs = await fetchAdzunaPython(q.query, q.location || 'United Kingdom', maxAgeDays);
        total += jobs.length;
        for (const job of jobs) processJob({ ...job, ageDays: job.age_days }, 'adzuna');
      } catch (err) {
        errors.push({ src: `Adzuna: ${q.query}`, msg: err.message });
      }
    }
    if (total === 0) {
      errors.push({ src: 'Adzuna', msg: 'zero results — check app_id/app_key in portals.yml' });
    }
  }

  // AI Jobs
  if (!filterCo && existsSync('aijobs_scan.py')) {
    try {
      const jobs = await fetchAijobsPython(maxAgeDays);
      for (const job of jobs) processJob({ ...job, ageDays: job.age_days }, 'aijobs');
      if (jobs.length === 0) {
        errors.push({ src: 'AI Jobs', msg: 'zero results — check aijobs_scan.py --debug' });
      }
    } catch (err) {
      errors.push({ src: 'AI Jobs', msg: err.message });
    }
  }

  // Reed
  if (reedApiKey && reedQueries.length && !filterCo) {
    for (const q of reedQueries) {
      try {
        for (const job of await fetchReed(q.query, q.location || 'London', reedApiKey)) {
          processJob(job, 'reed');
        }
      } catch (err) {
        errors.push({ src: `Reed: ${q.query}`, msg: err.message });
      }
    }
  }

  // Summary
  console.log(`\n${'─'.repeat(45)}`);
  console.log(`Scan complete — ${date}`);
  console.log(`${'─'.repeat(45)}`);
  console.log(`Found:      ${totalFound}`);
  console.log(`Filtered:   ${totalFiltered}`);
  console.log(`Too old:    ${totalStale}`);
  console.log(`Duplicates: ${totalDupes}`);
  console.log(`New:        ${totalNew}`);

  if (errors.length) {
    console.log(`\nErrors:`);
    for (const e of errors) console.log(`  ✗ ${e.src}: ${e.msg}`);
  }

  if (totalNew > 0) {
    console.log(`\n→ Run /jobscan eval to score new jobs against your CV.`);
  } else {
    console.log(`\nNo new jobs found.`);
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
