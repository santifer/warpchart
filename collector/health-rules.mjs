// Pure rules behind the watchdog's newer checks (collector/health.mjs). They
// live here so the tests can prove each one fires on the incident it exists
// for, and stays quiet on a normal day (an alarm that has to be doubted gets
// silenced, which is worse than no alarm).

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// PR FLOW leaves the UTC day in progress out, so yesterday appears at the first
// collector run after 00:00Z. The cron really runs every ~6 h (max gap seen
// 7.7 h), so yesterday may legitimately be missing until ~08:00Z; after 10:00Z
// a missing yesterday means the day never closed (26-sep: 25-sep stayed out all
// morning because that run was cancelled).
export function prflowFreshness(through, now = Date.now(), graceHourUtc = 10) {
  const yesterday = isoDay(now - DAY);
  const dayBefore = isoDay(now - 2 * DAY);
  const hour = new Date(now).getUTCHours();
  const expected = hour >= graceHourUtc ? yesterday : dayBefore;
  // a missing day is what a visitor sees; it is critical, not a warning
  return { ok: !!through && through >= expected, expected, severity: "critical" };
}

// What a panel reader would call "there": not null, not an empty list, not an
// empty object.
export const present = (v) =>
  v != null && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

const at = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

// The fields of the house repo's public dossier whose DISAPPEARANCE is a bug.
// Each one went missing once without an error: the npm channel for three
// weeks after the org transfer, the contributor chart after a census timeout.
export const PRESENCE_FIELDS = [
  "registry.velocityPerDay",
  "vitals.verdict",
  "vitals.leadTime",
  "vitals.responsiveness",
  "vitals.onboarding",
  "contributors.total",
  "contributors.maintainers",
  "contributors.series",
  "usage.npm",
  "usage.npm.series.points",
  "usage.npm.versions",
  "usage.clones.series",
  "activity30d",
];

export function presenceMap(dossier, fields = PRESENCE_FIELDS) {
  return Object.fromEntries(fields.map((f) => [f, present(at(dossier, f))]));
}

// Fields that were there last time and are gone now. A field seen for the
// first time is a baseline, never a change. (Kept for a quick one-off diff;
// the watchdog uses presenceEval, which remembers.)
export function presenceLost(prev, now) {
  if (!prev) return [];
  return Object.keys(now).filter((k) => prev[k] === true && now[k] === false);
}

// The watchdog's rule. The state REMEMBERS: a field once seen stays "seen", and
// while it is missing the finding keeps firing (a first version forgot after one
// run and would have gone green with npm still gone, closing the issue). One
// missing run is a warning (a live npm or GitHub call can blip); missing on two
// consecutive runs is critical. state: { [field]: { seen, missingSince } }
export function presenceEval(prevState, nowMap, nowIso = new Date().toISOString()) {
  const state = {};
  const findings = [];
  for (const [f, here] of Object.entries(nowMap)) {
    const was = prevState?.[f];
    if (here) {
      state[f] = { seen: true, missingSince: null };
    } else if (was?.seen) {
      const missingSince = was.missingSince ?? nowIso;
      state[f] = { seen: true, missingSince };
      findings.push({ field: f, missingSince, severity: was.missingSince ? "critical" : "warn" });
    } else {
      state[f] = { seen: false, missingSince: null };
    }
  }
  // fields no longer in PRESENCE_FIELDS drop out of the state on their own
  return { state, findings };
}

// The real cadence of the scheduled collector. Declared every 2 h; measured
// median ~5.8 h, max 7.7 h (16-sep). Thresholds sit above that normal so the
// check speaks only when the cadence actually degrades.
// The gap up to NOW counts too (a dead cron has no "completed" gap to show),
// and only RECENT gaps decide "critical": an old 12 h hole must not keep the
// alarm red for days after the cadence recovered.
export function cronLag(startTimesIso, now = Date.now(), recent = 6) {
  const t = startTimesIso.map((s) => Date.parse(s)).filter(Number.isFinite).sort((a, b) => a - b);
  if (t.length < 3) return null;
  const gaps = t.slice(1).map((x, i) => (x - t[i]) / HOUR);
  const sinceLastH = (now - t[t.length - 1]) / HOUR;
  const sorted = [...gaps].sort((a, b) => a - b);
  const m = sorted.length >> 1;
  const medianH = sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  const recentMaxH = Math.max(...gaps.slice(-recent), sinceLastH);
  const severity = recentMaxH > 12 ? "critical" : medianH > 8 ? "warn" : null;
  const r1 = (x) => Math.round(x * 10) / 10;
  return { medianH: r1(medianH), recentMaxH: r1(recentMaxH), sinceLastH: r1(sinceLastH), runs: t.length, severity };
}

// Partial markers left by collector/blob.mjs markPartial. Unresolved = a guard
// refused to publish and no complete run has happened since. Unresolved for
// more than a day = a whole day went by without the artifact recovering.
export function openPartials(markers, now = Date.now()) {
  // age from the FIRST refusal (`since`), not the latest one: a guard refusing
  // every 6 h would otherwise never look older than 6 h
  const open = markers
    .filter((m) => m && m.resolved === false && (m.since || m.at))
    .map((m) => ({ ...m, ageH: Math.round(((now - Date.parse(m.since ?? m.at)) / HOUR) * 10) / 10 }));
  const severity = open.some((m) => m.ageH > 24) ? "critical" : open.length ? "warn" : null;
  return { open, severity };
}

// Cancelled collector runs (the job cap cut them). Two or more in the window is
// the signal; "critical" only while one of them is RECENT (the newest `recent`
// runs, ~2 days), so the alarm clears on its own once a fix has held, instead
// of staying red for the ~5 days it takes old runs to leave a 24-run window.
// runs: newest first, as the Actions API lists them.
export function cancelledVerdict(runs, recent = 8) {
  const idx = runs.map((r, i) => (r?.conclusion === "cancelled" ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return { severity: null, cancelled: idx.length, of: runs.length };
  return { severity: idx[0] < recent ? "critical" : "warn", cancelled: idx.length, of: runs.length, newestIndex: idx[0] };
}

// coherence.eta: every published ETA must follow from the gap and the two
// velocities shown beside it; if it does not, the projection is reading other
// inputs. collisions.mjs rounds what it shows: velocities to whole stars/day and
// etaDays to 0.01 d. So the true closing lies in (c-1, c+1) around the shown
// c = hunter - victim, the true ETA in (gap/(c+1), gap/(c-1)), and the published
// value within half a unit (0.005 d) of it. Anything outside that interval
// cannot come from these numbers. A relative tolerance cannot do this: 15% is
// needed for a closing of 8/day (rounding alone moves the ETA 12.4%) but it
// hides a wrong velocity on a fast repo (±0.06% at 1,700/day), and it flagged
// an exact 0.0069 d shown as 0.01 (issue #46, 29-sep).
export function etaIncoherences(overtakes, halfUnit = 0.005) {
  const bad = [];
  const EPS = 1e-9;
  for (const o of overtakes ?? []) {
    const pair = `${o?.hunter?.repo} -> ${o?.victim?.repo}`;
    const hv = o?.hunter?.velocityPerDay, vv = o?.victim?.velocityPerDay, gap = o?.gap, pub = o?.etaDays;
    // an ETA that cannot be checked is not a checked ETA
    if (![hv, vv, gap, pub].every(Number.isFinite)) {
      bad.push({ pair, gap: gap ?? null, closing: null, published: pub ?? null, expected: null, reason: "non-numeric input" });
      continue;
    }
    const c = hv - vv;
    // a published crossing where the hunter is shown slower cannot come from
    // these numbers (collisions.mjs never publishes a closing under 8/day)
    if (c <= -1) {
      bad.push({ pair, gap, closing: c, published: pub, expected: null, reason: "hunter shown slower than victim" });
      continue;
    }
    const lo = gap / (c + 1) - halfUnit - EPS;
    const hi = c > 1 ? gap / (c - 1) + halfUnit + EPS : Infinity;
    if (pub < lo || pub > hi) {
      bad.push({ pair, gap, closing: c, published: pub, expected: c > 0 ? Math.round((gap / c) * 100) / 100 : null });
    }
  }
  return bad;
}

// Who watches the watchdog (collector/watchdog-alive.mjs). The health cron is
// declared every 2 h, but GitHub delays scheduled runs: over the 30 days to
// 30-sep the real gap was 4.7 h median, 7.9 h p99, 8.6 h max, and the old 6 h
// limit went red on 38 of 149 gaps with nothing broken. 12 h is silent on those
// 30 days; over the 400 runs since 6-aug it would have fired once, on a real
// 13.5 h hole that ended 28-aug 14:34Z, which is the kind worth hearing about.
// The alarm fires on the first collector run after 12 h, and the collector is
// late too (up to ~8 h), so the worst case is ~20 h. Blind spot, unchanged: if
// Actions stops BOTH workflows, nothing here fires.
export const WATCHDOG_MAX_AGE_H = 12;
// WATCHDOG_MAX_AGE_H from the environment: anything that is not a positive
// number falls back to the default instead of switching the alarm off.
export function maxAgeFromEnv(raw, fallback = WATCHDOG_MAX_AGE_H) {
  const n = raw === undefined || raw === null || String(raw).trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
// NaN (no timestamp, or a non-numeric limit) must read as stale, not alive.
export const watchdogStale = (ageH, maxAgeH = WATCHDOG_MAX_AGE_H) => !(ageH <= maxAgeH);

// How old anything the collector writes on EVERY run may get. Mirror of
// COLLECTOR_STALE_H in src/lib/staleness.ts (the app is TypeScript, the watchdog
// plain node; a test keeps the two equal). The cron is declared every 2 h but
// ran every 5.0 h median, 7.9 h p99, 8.5 h max over the 30 days to 30-sep. The
// tenant families were declared at 6 h, a limit 39 of those 140 gaps passed; how
// many became criticals depends on when health looks (30-sep 19:01Z did: three
// families "stopped updating" at 7 h, nothing broken). fresh.snapshot uses it too.
export const COLLECTOR_STALE_H = 10;

// Every family the system stores and the cadence it must keep (inventory.coverage
// in health.mjs). Invariant, tested: no periodic family may expect fresher than
// the collector can deliver, i.e. maxAgeH >= COLLECTOR_STALE_H.
export const ARTIFACTS = [
  // periodic: produced on a schedule; silence past maxAgeH means it stopped
  { prefix: "data/route.json", kind: "periodic", maxAgeH: 36, what: "the top-1000 registry" },
  { prefix: "data/history.jsonl", kind: "periodic", maxAgeH: COLLECTOR_STALE_H, what: "tenant snapshots" },
  { prefix: "data/stargazer_timestamps.txt", kind: "periodic", maxAgeH: COLLECTOR_STALE_H, what: "the tenant's per-star series" },
  { prefix: "data/meta.json", kind: "periodic", maxAgeH: COLLECTOR_STALE_H, what: "tenant repo metadata" },
  { prefix: "data/milestones.json", kind: "periodic", maxAgeH: 36, what: "rank milestones" },
  { prefix: "data/collisions.json", kind: "periodic", maxAgeH: 36, what: "the overtake scan" },
  { prefix: "data/catalog.json", kind: "periodic", maxAgeH: 36, what: "the rising catalog" },
  { prefix: "data/route-prev.json", kind: "periodic", maxAgeH: 72, what: "the previous registry (velocity baseline)" },
  { prefix: "data/enrichment.json", kind: "periodic", maxAgeH: 72, what: "repo enrichment" },
  { prefix: "data/forensics.json", kind: "periodic", maxAgeH: 72, what: "spike forensics" },
  { prefix: "data/attribution.json", kind: "periodic", maxAgeH: 72, what: "spike attribution" },
  { prefix: "data/indexnow-stamp.txt", kind: "periodic", maxAgeH: 48, what: "the IndexNow ping stamp" },
  { prefix: "route-history/", kind: "periodic", maxAgeH: 36, what: "the daily rank moat" },
  // rebuilt once per recorded rank-history day (collector/velocity-rank.mjs)
  { prefix: "velocity-rank/", kind: "periodic", maxAgeH: 36, what: "the daily velocity-rank table" },
  // builders.yml every 6 h; it skips while the people are the same and the
  // wall is under 20 h old, so a healthy wall is at most ~26 h old
  { prefix: "builders/", kind: "periodic", maxAgeH: 30, what: "the README builders wall" },
  { prefix: "vitals/", kind: "periodic", maxAgeH: 72, what: "the Vital Signs panel" },
  { prefix: "contributors/", kind: "periodic", maxAgeH: 12, what: "the contributor census (cohorts source)" },
  { prefix: "traffic/", kind: "periodic", maxAgeH: 12, what: "the Traffic Vault" },
  { prefix: "prflow/", kind: "periodic", maxAgeH: 12, what: "the PR flow panel" },
  { prefix: "npm-versions/", kind: "periodic", maxAgeH: 36, what: "npm downloads by version (daily snapshot)" },
  // health/ is rewritten earlier in the same run (contracts, presence), so it
  // is always fresh here; the real "is the watchdog alive" sensor is
  // collector/watchdog-alive.mjs. The limit only keeps the declaration honest.
  { prefix: "health/", kind: "periodic", maxAgeH: WATCHDOG_MAX_AGE_H, what: "this watchdog's own output" },
  { prefix: "live/", kind: "periodic", maxAgeH: 12, what: "live star polling" },
  { prefix: "badges-earned.json", kind: "periodic", maxAgeH: 36, what: "earned badges" },
  // Declared so they are WATCHED, not so they are shown: nothing reads these
  // keys but the owner. Declaring them also keeps `inventory.undeclared` from
  // naming the `private/` family in the watchdog's PUBLIC issue. If one goes
  // stale the issue names the file and its age, never a number from inside it.
  // Listed individually rather than as a `private/` prefix because they have
  // genuinely different cadences, and one declaration would hide the other:
  // followers writes every run, installs only when an event fires.
  { prefix: "private/followers.json", kind: "periodic", maxAgeH: 12, what: "the owner's private standing series" },
  // event: written only when something happens outside; silence is information,
  // never a failure
  { prefix: "embeds/", kind: "event", what: "first sighting of an embed on GitHub" },
  { prefix: "codex/", kind: "event", what: "LLM dossiers, written on first visit to a repo" },
  { prefix: "alerts/", kind: "event", what: "alert dedup state" },
  // Silence here is the normal state and means "no install wave since the last
  // one": in 63 days of history exactly one day qualified. Never a failure.
  { prefix: "private/installs.json", kind: "event", what: "detected install waves (private)" },
  // config: edited by a human, age means nothing
  { prefix: "data/tenants.json", kind: "config", what: "the paying-tenant list" },
];

// Which declared periodic families are older than they may be. `newest` maps a
// family prefix to its newest upload (ms). A timestamp that is not a number reads
// as stale, never as fresh.
export function staleArtifacts(newest, now = Date.now(), artifacts = ARTIFACTS) {
  const stale = [];
  const missing = [];
  for (const a of artifacts) {
    if (a.kind !== "periodic") continue;
    const t = newest.get(a.prefix);
    if (t === undefined) { missing.push(a); continue; }
    const ageH = (now - t) / HOUR;
    if (!(ageH <= a.maxAgeH)) stale.push({ ...a, ageH });
  }
  return { stale, missing };
}

// pipeline.*: the Actions API can hand one token of the pool a STALE runs list.
// 30-sep: a page ending on 6-sep 23:50Z was judged as today's, "568.7 h since the
// last scheduled run" and "3 of 24 cancelled", hours after the collector had run
// (that real page reproduces both numbers exactly; the API answers with
// `Vary: Authorization`, so a cache per token fits). gh() used the first 200 of
// the pool, so the verdict flipped with whichever token answered first.
export function newestRunMs(runs) {
  const t = (runs ?? []).map((r) => Date.parse(r?.run_started_at ?? r?.created_at)).filter(Number.isFinite);
  return t.length ? Math.max(...t) : NaN;
}

const isoOrNull = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

// responses: one { ok, body } per token, in pool order. Keeps the freshest list;
// perToken records what each token saw, so a stale token can be named. A 200
// without a workflow_runs array is an unreadable answer, not an empty list.
export function pickFreshestRuns(responses) {
  let best = null;
  const perToken = (responses ?? []).map((r, token) => {
    const list = r?.ok && Array.isArray(r.body?.workflow_runs) ? r.body.workflow_runs : null;
    const newest = list ? newestRunMs(list) : NaN;
    if (list && (best === null || (Number.isFinite(newest) && !(newest <= best.newest)))) best = { list, token, newest };
    return { token, ok: !!list, runs: list ? list.length : null, newest: isoOrNull(newest) };
  });
  return { list: best?.list ?? [], token: best?.token ?? null, newest: best?.newest ?? NaN, perToken };
}

// How far the newest listed run may trail the collector's last snapshot before
// the list counts as missing runs: a normal cron gap (COLLECTOR_STALE_H) plus
// the run that wrote the snapshot possibly still being in progress (job cap
// 25 min, rounded to 1 h). Accepted rare case: right after a real hole longer
// than this, while the recovering run is still in progress, one pass may read
// "stale list" instead of cron-lag; the next pass sees the >12 h hole and
// cron-lag fires critical. The delay is one pass at most.
export const RUNS_LIST_TOL_H = COLLECTOR_STALE_H + 1;

// A runs list whose newest run is older than the collector's own last snapshot
// (beyond RUNS_LIST_TOL_H) is missing runs: judging it would read an old sample
// as current. Without an independent timestamp we cannot tell: not stale. A
// cron that really died is NOT a stale list: its snapshot is as old as its runs.
export function runsListStale(newestMs, lastSnapshotMs, tolH = RUNS_LIST_TOL_H) {
  if (!Number.isFinite(lastSnapshotMs)) return false;
  return !Number.isFinite(newestMs) || lastSnapshotMs - newestMs > tolH * HOUR;
}

// Tokens whose own list trails the reference: a symptom worth naming even when
// the freshest list is fine (the collector uses the same pool for other calls).
// Reference = the collector's snapshot, or the freshest list when the snapshot
// is unknown. A token that read an EMPTY list while another had runs lags too.
export function laggingTokens(perToken, refMs, freshestHasRuns = true) {
  return (perToken ?? []).filter((t) =>
    t.ok && (t.newest ? runsListStale(Date.parse(t.newest), refMs) : freshestHasRuns && t.runs === 0));
}

// The whole decision before any pipeline verdict: which list to judge, or why none.
// gate: "ok" | "unreadable" (no token, or none could read it) | "empty" (readable, no runs,
// snapshot known) | "none" (readable, no runs, nothing to compare) | "stale".
export function pipelineRunsGate(responses, lastSnapshotMs) {
  const picked = pickFreshestRuns(responses);
  const base = { ...picked, newestIso: isoOrNull(picked.newest), lagging: [] };
  // no token at all, or none that could read: never a pass
  if (!picked.perToken.some((t) => t.ok)) return { ...base, gate: "unreadable" };
  if (!picked.list.length) return { ...base, gate: Number.isFinite(lastSnapshotMs) ? "empty" : "none" };
  if (runsListStale(picked.newest, lastSnapshotMs)) return { ...base, gate: "stale" };
  const ref = Number.isFinite(lastSnapshotMs) ? lastSnapshotMs : picked.newest;
  return { ...base, gate: "ok", lagging: laggingTokens(picked.perToken, ref, picked.list.length > 0) };
}

// The contributor count the dossier publishes must be the one GitHub shows on the
// repo page (the panel links there). Both move daily, so a small gap is the two
// readings being hours apart; a large one is the REST /contributors cap (463 vs
// 611 on 2026-10-11) or a stale vitals run.
export function contributorsDrift(published, github, tolPct = 3) {
  if (published == null) return { severity: "warn", note: "dossier publishes no contributor count (GitHub's could not be read)" };
  if (github == null) return { severity: null, note: "GitHub sidebar unreadable this run; not compared" };
  const gap = Math.abs(published - github) / github * 100;
  return gap > tolPct
    ? { severity: "warn", note: `dossier says ${published} contributors, GitHub shows ${github} (${gap.toFixed(1)}% apart)` }
    : { severity: null, note: `${published} vs GitHub ${github}` };
}

// BUILDERS WALL (/api/builders, collector/builders.mjs): the README image of
// everyone who landed work. It prints "N joined this week", so a wall that
// stops refreshing lies within days. Missing = never published (or wiped);
// older than maxH = builders.yml stopped or keeps refusing (see its partial
// marker). A wall that LOST people means the census shrank: never expected.
export function buildersWallFreshness(meta, now = Date.now(), maxH = 30) {
  if (!meta?.generatedAt) return { severity: "warn", note: "no builders wall published (builders/{repo}.json missing)" };
  const ageH = (now - Date.parse(meta.generatedAt)) / 3600e3;
  if (!(ageH <= maxH)) return { severity: "warn", note: `builders wall is ${ageH.toFixed(0)} h old (max ${maxH} h): builders.yml stopped or refuses` };
  if (!meta.langs?.includes("en")) return { severity: "warn", note: "builders wall has no English version (the route's fallback)" };
  // the route caches the SVG in Next's data cache, which silently skips entries
  // over 2 MB; the collector refuses at 1.8 MB, so this only fires if that guard went
  if (meta.bytes > 1.8 * 1024 * 1024) return { severity: "warn", note: `builders wall is ${(meta.bytes / 1048576).toFixed(2)} MB (cache limit 2 MB)` };
  return { severity: null, note: `${meta.people} people, ${meta.week} this week, ${meta.langs.length} languages, ${ageH.toFixed(1)} h old` };
}

// DAILY VELOCITY RANK (collector/velocity-rank.mjs -> velocity-rank/*.json):
// the locked "place among the top 1,000 by new stars" chart. It is rebuilt in
// the same collect run that records a rank-history day, so a table that does
// not reach the newest recorded day more than `graceH` after its capture has
// stopped (or keeps refusing: see its partial marker 'velocity-rank').
// rhLast = newest route-history day, rhAt = its capture ISO (or null).
// graceH is above the collect cadence on purpose: runs have come 8 h apart
// (19-oct, 04:40 -> 12:58Z), and a threshold under the real cadence is how
// the 30-sep false alarms happened. lastN < minN = the newest day ranked a
// top 1,000 with holes in it (the 2026-06-29 shape): every rank reads better.
export function velocityRankFreshness(meta, rhLast, rhAt, now = Date.now(), graceH = 10, minN = 990) {
  if (!meta?.lastTo) return { severity: "warn", note: "no velocity-rank table published (velocity-rank/meta.json missing)" };
  if (meta.lastN != null && meta.lastN < minN) return { severity: "warn", note: `newest velocity-rank day (${meta.last}) ranked only ${meta.lastN} of the top 1,000` };
  if (!rhLast) return { severity: null, note: "rank-history unreadable this run; not compared" };
  if (meta.lastTo >= rhLast) return { severity: null, note: `${meta.days} days (${meta.first} .. ${meta.last}), built through ${meta.lastTo}` };
  const sinceH = (now - Date.parse(rhAt ?? `${rhLast}T00:00:00Z`)) / 3600e3;
  if (!(sinceH > graceH)) return { severity: null, note: `rank-history recorded ${rhLast} ${sinceH.toFixed(1)} h ago; table still on ${meta.lastTo}` };
  return { severity: "warn", note: `velocity-rank table stops at ${meta.lastTo}, rank-history has ${rhLast} (${sinceH.toFixed(0)} h ago)` };
}

// Each published language must be SERVED in that language: on 17-oct-2026
// ?lang=es and ?lang=pt-BR kept the English fallback for an hour after their
// walls existed (a cached "not found"), and only Santiago saw it. served:
// { lang: Content-Language answered, or null if the request failed }.
export function buildersLangMismatch(langs, served) {
  const bad = (langs ?? []).filter((l) => served?.[l] !== l);
  return bad.length
    ? { severity: "warn", note: `builders wall not served in its language: ${bad.map((l) => `${l}→${served?.[l] ?? "error"}`).join(", ")}` }
    : { severity: null, note: `${(langs ?? []).length} languages served in their own language` };
}

// The contributor chart draws GitHub's own count over time and must END on the
// figure the panel prints (one number on the page, 2026-10-11). A missing curve
// means the calibration refused (rebuild >5% off) or the census never ran: the
// chart silently fell back to the authors/co-authored toggle.
export function contributorCurve(contributors) {
  if (!contributors) return { severity: null, note: "no contributors block" };
  const total = contributors.total ?? null;
  const last = contributors.series?.github?.points?.at(-1)?.cumulative ?? null;
  if (total == null) return { severity: null, note: "no live figure; covered by presence.contributors" };
  // critical, not warn: on 2026-10-16 the house panel fell back to "516
  // authors" for hours and only Santiago saw it (a warn opens no issue)
  if (last == null) return { severity: "critical", note: `no GitHub-count curve; the chart fell back to the census toggle (total ${total})` };
  return last === total
    ? { severity: null, note: `curve ends on ${total}, GitHub's figure` }
    : { severity: "warn", note: `curve ends on ${last} but the panel prints ${total}` };
}

// /compare and the embeds draw the house curve from the star timestamps, which
// only grow (unstars keep their row). Its last point must be the net count it
// reports as `total`: on 2026-10-14 it ended 1,490 stars high (75,922 vs 74,432)
// and the race page showed career-ops passing 75K before it had.
export function curveEndsOnTotal(curve) {
  const last = curve?.pts?.at(-1)?.v ?? null;
  const total = curve?.total ?? null;
  if (last == null || total == null) return { severity: "warn", note: "house curve unreadable" };
  const gap = last - total;
  return Math.abs(gap) <= Math.max(5, total * 0.001)
    ? { severity: null, note: `curve ends on ${last}, total ${total}` }
    : { severity: "warn", note: `curve ends on ${last} but the repo has ${total} stars (${gap > 0 ? "+" : ""}${gap})` };
}

// npm usage on the house dossier: the weekly breakdown may now be a recorded
// week (npm-versions fallback while npm's series has holes). That is honest
// while its date is visible, but a fallback that never refreshes is the panel
// going quietly stale. And a last-30 total with holes is a published floor:
// expected upstream noise, reported, never critical.
export function npmUsageFreshness(npm, todayISO, maxAgeDays = 10) {
  if (!npm) return { severity: null, note: "no npm channel" };
  const through = npm.versions?.through ?? null;
  const ageDays = through ? Math.round((Date.parse(`${todayISO}T00:00:00Z`) - Date.parse(`${through}T00:00:00Z`)) / 864e5) : null;
  const floor = npm.last30IsLowerBound ? `last30 is a floor (${npm.last30MissingDays} of 30 days missing in npm's data)` : "";
  // the estimate is the headline when days are missing: its absence is a bug
  if ((npm.last30MissingDays ?? 0) > 0 && npm.last30Estimate == null) {
    return { severity: "warn", ageDays, note: `${npm.last30MissingDays} npm days missing but no last30Estimate published` };
  }
  if (ageDays !== null && ageDays > maxAgeDays) {
    return { severity: "warn", ageDays, note: [`NPM BY VERSION is ${ageDays} days old (through ${through})`, floor].filter(Boolean).join(" · ") };
  }
  // without npm's `latest` the footnote can only name the newest version IN a
  // possibly old week, which read as "newest release" (v1.35.0 two days after
  // v1.36.0 shipped, 2026-10-12)
  if (npm.versions && !npm.latest) {
    return { severity: "warn", ageDays, note: "npm `latest` dist-tag missing: the version footnote cannot tell a newer release apart (a one-off npm registry blip also lands here)", latestMissing: true };
  }
  return { severity: null, ageDays, note: [through ? `versions through ${through}` : "no versions", floor].filter(Boolean).join(" · ") };
}

// The 7-day rate of the house repo must close on a point younger than this.
// The window closes on the newest recorded day (captured ~00:25Z) or the
// registry refresh (~daily, later in the day), whichever is newer, so a normal
// day never sees it older than ~20 h. On 2026-10-16 the site served a v7 that
// closed ~24 h back, while a fresher day already sat in the rank history.
export const V7_WINDOW_MAX_H = 26;

// { ok, reason, ageH, v7_to } for `repo` in route.json. Absence fails: a repo
// without v7_to is a repo whose rate nobody can date (presence check).
export function v7WindowFreshness(route, repo, now = Date.now(), maxH = V7_WINDOW_MAX_H) {
  const p = (route?.repos ?? []).find((x) => x?.r?.toLowerCase() === repo.toLowerCase());
  if (!p) return { ok: false, reason: "missing", ageH: null, v7_to: null };
  const ms = typeof p.v7_to === "string" ? Date.parse(p.v7_to) : NaN;
  if (!Number.isFinite(ms)) return { ok: false, reason: "absent", ageH: null, v7_to: p.v7_to ?? null };
  const ageH = (now - ms) / HOUR;
  return { ok: ageH <= maxH, reason: ageH <= maxH ? null : "stale", ageH, v7_to: p.v7_to };
}

// route.v7_at is the later of the registry refresh and the newest recorded
// day; one OLDER than generated_at means v7 was computed for a previous
// registry and lags its own star counts.
export function v7StampLags(route) {
  const a = Date.parse(route?.v7_at ?? "");
  const g = Date.parse(route?.generated_at ?? "");
  if (!Number.isFinite(a)) return true;
  return Number.isFinite(g) && a < g;
}
