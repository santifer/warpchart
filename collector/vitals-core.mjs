// The pure half of collector/vitals.mjs: every rule that turns GitHub's answers
// into a number on the Vital Signs panel, with no network, no Blob and no
// clock of its own. vitals.mjs is a script with side effects at import (token
// check, config, exit without a Blob token); this module is what the tests
// pin down, so each past wrong number stays fixed.

const DAY = 864e5;

export const BOTS = new Set([
  "github-actions", "renovate", "dependabot", "renovate-bot", "codecov",
  // the manifesto ledger's service account: commits under a human-shaped login
  "careerops-ledger",
]);
export const isBot = (l) => !l || BOTS.has(l.toLowerCase()) || l.toLowerCase().endsWith("[bot]");

// BY VOLUME OF MERGES, never by insertion order. This list is what names the
// repo in the panel ("operated by X"), and a Set iterates in the order logins
// were first seen - which, scanning PRs newest-first, is whoever merged the
// MOST RECENT pull request. On 2026-09-15 the live panel read "operated by
// FReptar0" because a contributor merged his first PR twelve days earlier and
// landed ahead of the person who had merged everything else. Whoever holds the
// merge gate is the one who merges most, so that is the order.
export function rankMaintainers(mergerCount, limit = 6) {
  return [...mergerCount.entries()]
    .filter(([l]) => !isBot(l))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([l]) => l);
}

// The contributor count GitHub itself shows in the sidebar of the repo page (what
// a reader sees when they check the panel), read from github.com/{repo}/_sidebar. One request for
// any repo size. The REST /contributors list it replaces caps at the first 500
// author emails and calls the rest anonymous: career-ops read 463 there while
// GitHub showed 611 (2026-10-11). null = could not read it, never a guess.
export function parseSidebarContributors(json) {
  const n = json?.contributors?.contributorCount;
  return Number.isInteger(n) && n > 0 ? n : null;
}

// One merged-PR sweep -> DORA lead time + the human engine. `nodes` are the
// merged PRs as GraphQL returns them (newest first), `want` the sample cap the
// sweep ran with, `contributorsTotal` GitHub's own count from
// parseSidebarContributors (null when it could not be read), `mergedTotal` GitHub's totalCount.
export function derivePrAnalysis({ nodes, want = 1000, now = Date.now(), mergedTotal = null, contributorsTotal = null }) {
  const hrs = [];
  const authorCount = new Map();
  const mergerCount = new Map(); // login -> merges, NOT a Set: the order matters
  const monthAuthors = new Map(); // "YYYY-MM" -> Set(login)
  // Two different windows on purpose. COHORTS need the whole history to say who
  // came back; LEAD TIME is a statement about how the project works NOW, so it
  // only counts PRs merged in the last 90 days. Measuring it over all 707 mixed
  // in the slower early months and dropped the repo from Elite to High while
  // nothing about today had changed.
  const LEAD_WINDOW = now - 90 * DAY;
  let scanned = 0;
  for (const n of nodes) {
    if (!n.createdAt || !n.mergedAt) continue;
    scanned++;
    const merged = Date.parse(n.mergedAt);
    const h = (merged - Date.parse(n.createdAt)) / 36e5;
    if (h >= 0 && merged >= LEAD_WINDOW) hrs.push(h);
    const au = n.author?.login;
    if (au) {
      authorCount.set(au, (authorCount.get(au) || 0) + 1);
      const m = n.createdAt.slice(0, 7);
      if (!monthAuthors.has(m)) monthAuthors.set(m, new Set());
      monthAuthors.get(m).add(au);
    }
    if (n.mergedBy?.login) mergerCount.set(n.mergedBy.login, (mergerCount.get(n.mergedBy.login) || 0) + 1);
  }

  let leadTime = null;
  if (hrs.length) {
    hrs.sort((a, b) => a - b);
    const q = (p) => {
      const k = (hrs.length - 1) * p;
      const f = Math.floor(k);
      return hrs[f] + (hrs[Math.min(f + 1, hrs.length - 1)] - hrs[f]) * (k - f);
    };
    const median = q(0.5);
    leadTime = {
      medianH: Math.round(median * 10) / 10,
      p90H: Math.round(q(0.9) * 10) / 10,
      tier: median < 24 ? "Elite" : median < 168 ? "High" : median < 720 ? "Medium" : "Low",
      windowDays: 90, // the window this median describes, so the panel can say so
      sample: hrs.length,
      pctUnder24h: Math.round((hrs.filter((h) => h <= 24).length / hrs.length) * 100),
      pctUnder7d: Math.round((hrs.filter((h) => h <= 168).length / hrs.length) * 100),
    };
  }

  // human contributors (bots excluded), top by merged-PR count
  const humans = [...authorCount.entries()].filter(([l]) => !isBot(l)).sort((a, b) => b[1] - a[1]);
  // Did we stop before reaching the repo's first PR? Then the OLDEST month in
  // the sample is a lie by construction: nobody can be "returning" in it,
  // because the algorithm has not seen anyone yet. On 2026-07-28 that published
  // "returning devs 0 → 18" for a repo whose June returners simply fell outside
  // the window - and the series jumped from "1 → 7 → 17" to "0 → 18" overnight
  // as the growing PR volume shrank the window. Drop the truncated month.
  const truncated = scanned >= want;
  const months = [...monthAuthors.keys()].sort();
  // new-vs-returning cohorts (chronological)
  const seen = new Set();
  const cohorts = months
    .map((m) => {
      const au = [...monthAuthors.get(m)].filter((l) => !isBot(l));
      const nw = au.filter((l) => !seen.has(l)).length;
      const rt = au.filter((l) => seen.has(l)).length;
      au.forEach((l) => seen.add(l));
      return { month: m, new: nw, returning: rt };
    })
    .filter((c) => !(truncated && c.month === months[0]));
  const community = scanned
    ? {
        // the real repo-wide figure; `contributorsSampled` is what the window saw
        // null when GitHub's count could not be read: the sample is NOT a total
        // and must never be published as one
        contributors: contributorsTotal ?? null,
        contributorsSampled: humans.length,
        mergedTotal, // every merged PR ever, not just the sampled window
        prsSampled: hrs.length,
        mergedByDistinct: mergerCount.size || 1,
        maintainers: rankMaintainers(mergerCount), // the actual merge-gate keepers
        topContributors: humans.slice(0, 10).map(([login]) => ({ login })),
        cohorts,
      }
    : null;

  return { leadTime, community, scanned };
}

// Good first issues: count OPENINGS, not signs. `no:assignee` drops the claimed
// ones; `-linked:pr` drops the ones with a PR on the way. Both server-side.
export function gfiQueries(repo) {
  const base = (label) => `repo:${repo} is:issue is:open label:"${label}"`;
  return {
    q: base("good first issue"),
    q2: base("good-first-issue"),
    f: `${base("good first issue")} no:assignee -linked:pr`,
    f2: `${base("good-first-issue")} no:assignee -linked:pr`,
  };
}

// The free set is a subset of the open set by construction; if the two
// spellings ever disagree enough to break that, trust the smaller number.
// A failed lookup is handled by the caller as null, never as free = open.
export function gfiFromCounts(d) {
  // an alias that did not answer is unknown, never 0
  const n = (k) => (Number.isFinite(d?.[k]?.issueCount) ? d[k].issueCount : null);
  const [a, b, c, e] = ["a", "b", "c", "d"].map(n);
  if ([a, b, c, e].some((x) => x === null)) return null;
  const open = Math.max(a, b);
  const freeRaw = Math.max(c, e);
  return { goodFirstIssues: open, goodFirstIssuesFree: Math.min(freeRaw, open) };
}

// Clone conversion from the Traffic Vault: the 7 complete UTC days before
// `today`, by DATE. `days.slice(-7)` was a window by count: with a hole in the
// vault it reached back past the week and still called the result a week.
//
// Sums `c` (clone events) for the week, never `u`. `u` is uniques PER DAY: one
// person who clones on five days adds five to a sum of `u`. That sum shipped
// here as `uniqueClonersWeek`, the same 3x overstatement the dossier dropped on
// 2026-08-13 (91,685 summed vs 29,837 deduplicated by GitHub). It is gone, and
// so is `clonesPerCloner`, which divided by it.
//
// The conversion stays a ratio of per-day uniques on BOTH sides (cloner-days
// over visitor-days), so the units cancel; it is not a headcount either.
//
// A day GitHub answered for and left out had no traffic: the vault's latest
// reading (`uniq14.at`) covers its own 14 days. A day nobody asked GitHub about
// is unknown, and an unknown day means no week: null, never a partial sum.
export function adoptionFromVault(vault, today) {
  if (!vault?.views || !vault?.clones) return null;
  const DAY = 864e5;
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end)) return null;
  const window = Array.from({ length: 7 }, (_, i) => new Date(end - (7 - i) * DAY).toISOString().slice(0, 10));
  const at = vault.uniq14?.at ?? null;
  const from = at ? new Date(Date.parse(`${at}T00:00:00Z`) - 13 * DAY).toISOString().slice(0, 10) : null;
  const answered = (d) => at !== null && d >= from && d <= at;
  const read = (series, d) => series[d] ?? (answered(d) ? { c: 0, u: 0 } : null);
  let uV = 0;
  let uC = 0;
  let cC = 0;
  for (const d of window) {
    const v = read(vault.views, d);
    const c = read(vault.clones, d);
    if (!v || !c) return null;
    uV += v.u || 0;
    uC += c.u || 0;
    cC += c.c || 0;
  }
  return {
    cloneConvPct: uV > 0 ? Math.round((uC / uV) * 100) : null,
    clonesWeek: cC,
  };
}
