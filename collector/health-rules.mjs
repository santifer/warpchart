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
