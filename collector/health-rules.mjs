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
  return { severity: null, ageDays, note: [through ? `versions through ${through}` : "no versions", floor].filter(Boolean).join(" · ") };
}
