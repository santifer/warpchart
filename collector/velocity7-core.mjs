// The pure half of collector/velocity7.mjs: how a trailing 7-day rate is
// measured from the rank-history series, including the star-purge and
// restore steps that once published -2903/d and then +4587/d for a repo that
// was really growing ~120/d. No network, no Blob: the tests pin it down.

const DAY = 864e5;

// WHEN a recorded day was measured. route-history.mjs records day D at the
// first collector run after 00:00Z (00:24Z, 04:27Z...), not at noon: dating
// every point at 12:00Z put each one 7-12 h away from its real capture, and the
// 7-day window with it. `capturedAt` is route-history's meta.capturedAt
// ({ day: ISO }). A day without a stamp (recorded before stamps existed) takes
// the time of day of the LATEST known capture: dating it at noon made ruflo's
// last day 12 h long and its v1 read 782/d instead of ~405/d. Noon only when no
// capture time is known at all. A stamp from another day is corrupt: ignored.
const validStamp = (day, iso) => {
  if (typeof iso !== "string" || iso.slice(0, 10) !== day) return NaN;
  return Date.parse(iso);
};
const fallbackTod = new WeakMap(); // capturedAt -> ms after 00:00Z, or null
function knownTimeOfDay(capturedAt) {
  if (!capturedAt || typeof capturedAt !== "object") return null;
  if (fallbackTod.has(capturedAt)) return fallbackTod.get(capturedAt);
  let latest = NaN;
  for (const [day, iso] of Object.entries(capturedAt)) {
    const ms = validStamp(day, iso);
    if (Number.isFinite(ms) && !(ms <= latest)) latest = ms;
  }
  const tod = Number.isFinite(latest) ? latest - Date.parse(`${new Date(latest).toISOString().slice(0, 10)}T00:00:00Z`) : null;
  fallbackTod.set(capturedAt, tod);
  return tod;
}
export function pointMs(day, capturedAt = null) {
  const own = validStamp(day, capturedAt?.[day]);
  if (Number.isFinite(own)) return own;
  const tod = knownTimeOfDay(capturedAt);
  if (tod != null) return Date.parse(`${day}T00:00:00Z`) + tod;
  return Date.parse(`${day}T12:00:00Z`);
}

// A star PURGE (GitHub deleting farmed stars, or a repo transfer) drops a repo
// by thousands in a single day. That step is a one-off correction, not growth,
// but a naive 7-day rate spreads it over the whole window: odysseus-dev/odysseus
// lost 21.8k on 2026-07-24 and read -2903/d for days while actually growing at
// ~120/d. A negative rate that large poisons every projection downstream (a
// rival "losing" 2900/d makes projectCrossing report an overtake in hours, and
// it stays wrong until the step falls out of the window). So: find the step and
// measure only AFTER it.
export const PURGE_PCT = 0.02; // a single-day drop of >=2% of the count...
export const PURGE_ABS = 300; // ...and >=300 stars, so ordinary unstar noise is ignored
// A RESTORE is the same event in reverse: on 2026-07-29 GitHub gave odysseus
// back the 21.8k it had removed on the 24th (+21,863 in one day), and the rate
// read +4,587/d - which put it top of the public velocity ranking as the
// fastest-growing repo on GitHub. Fixing only the drop direction was half a
// fix: a step is a step whichever way it points.
//
// The test is deliberately ASYMMETRIC, because the two directions are not
// equally suspicious. Nothing sheds 2% of its stars in a day organically, so
// any drop that size is administrative. But a repo CAN gain that much honestly
// (a Hacker News front page), so a rise only counts as a step when it
// REVERSES a drop we already recorded - which is exactly what a restore is,
// and what viral growth never is.
export const RESTORE_MATCH = 0.25; // a rise within 25% of an earlier drop reverses it

// Baseline for the trailing rate. Returns { then: [dayMs, stars], purge } where
// `purge` is the ISO day of the most recent step inside the window, or null.
// series = [[isoDay, rank, stars], ...]
export function baselineFor(series, targetMs, todayMs, currentStars = null, capturedAt = null) {
  const pts = series
    .map((p) => [pointMs(p[0], capturedAt), p[2], p[0]])
    .filter((p) => Number.isFinite(p[0]) && p[1] != null && p[0] < todayMs - 0.5 * DAY)
    .sort((a, b) => a[0] - b[0]); // ignore today; oldest first
  if (!pts.length) return null;

  // The step can land in the gap between the last recorded day and NOW - which
  // is exactly what happened on 2026-07-29: the restore was excluded as "today"
  // while `p.s` already carried it, so the numerator jumped 21.8k and the
  // baseline never moved. Compare the live count against the last recorded day
  // and, when that gap is itself a step, report it with NO usable baseline:
  // after a correction we cannot know the real pace until a clean day passes.
  if (currentStars != null && pts.length) {
    const last = pts[pts.length - 1];
    const delta = currentStars - last[1];
    if (Math.abs(delta) >= PURGE_ABS && Math.abs(delta) >= last[1] * PURGE_PCT) {
      const drops = [];
      for (let i = 1; i < pts.length; i++) {
        const d = pts[i - 1][1] - pts[i][1];
        if (d >= PURGE_ABS && d >= pts[i - 1][1] * PURGE_PCT) drops.push(d);
      }
      const isRestore = delta > 0 && drops.some((d) => Math.abs(d - delta) <= d * RESTORE_MATCH);
      if (delta < 0 || isRestore) return { then: null, purge: "today" };
    }
  }

  // Every drop in the WHOLE series, so a restore can be matched against one
  // that happened before the current window opened.
  const drops = [];
  for (let i = 1; i < pts.length; i++) {
    const drop = pts[i - 1][1] - pts[i][1];
    if (drop >= PURGE_ABS && drop >= pts[i - 1][1] * PURGE_PCT) drops.push(drop);
  }

  // most recent step inside [targetMs, now], in either direction
  let purgeIdx = -1;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] < targetMs) continue;
    const delta = pts[i][1] - pts[i - 1][1];
    const big = Math.abs(delta) >= PURGE_ABS && Math.abs(delta) >= pts[i - 1][1] * PURGE_PCT;
    if (!big) continue;
    if (delta < 0) {
      purgeIdx = i; // a drop of this size is never organic
    } else if (drops.some((d) => Math.abs(d - delta) <= d * RESTORE_MATCH)) {
      purgeIdx = i; // a rise that gives back an earlier drop: a restore
    }
  }
  // measure from the first post-step point: that count is the corrected one
  if (purgeIdx >= 0) return { then: [pts[purgeIdx][0], pts[purgeIdx][1]], purge: pts[purgeIdx][2] };

  // no step: the recorded point closest to the 7-day target
  let best = null;
  for (const p of pts) {
    if (best === null || Math.abs(p[0] - targetMs) < Math.abs(best[0] - targetMs)) {
      best = [p[0], p[1]];
    }
  }
  return best ? { then: best, purge: null } : null;
}

// The 7-day rate for one repo. Returns null when there is no baseline at all,
// otherwise { v7, purge, measured }:
//   v7 undefined  -> leave the repo's rate alone (baseline shorter than a day)
//   purge         -> ISO day of the step, "today", "unknown" (backstop) or null
//   measured      -> a real trailing rate was computed (counts as "got a v7")
export function v7For(stars, series, targetMs, todayMs, capturedAt = null) {
  const base = baselineFor(series, targetMs, todayMs, stars, capturedAt);
  if (!base) return null;
  // A step landed between the last recorded day and now: there is no clean
  // baseline on the far side of it yet. 0 is the honest reading until a full
  // day passes - "no measurable momentum", not a fabricated surge.
  if (!base.then) return { v7: 0, purge: base.purge, measured: false };
  const days = (todayMs - base.then[0]) / DAY;
  if (days < 1) {
    // Baseline too short to measure. Normally leave `v` alone, but a purge
    // poisons `v` too (it is a ~1-day diff and the step IS that day), so pin
    // the rate to 0: "no measurable momentum" beats a false crash.
    return { v7: base.purge ? 0 : undefined, purge: base.purge, measured: false };
  }
  let v7 = Math.round(((stars - base.then[1]) / days) * 10) / 10;
  let purge = base.purge;
  // Backstop for a step the series could not show (a gap in the history, a
  // rename, a restore whose matching drop was never recorded). No real repo
  // sheds >5% of its stars per day, and none sustains +5%/day for a whole week
  // either - at that rate a 60k repo would double inside a month. Symmetric on
  // purpose: the 2026-07-29 restore proved that trusting only the downward
  // direction just moves the lie to the other side.
  if (Math.abs(v7) > Math.max(PURGE_ABS, stars * 0.05)) {
    v7 = 0;
    if (!purge) purge = "unknown";
  }
  return { v7, purge, measured: true };
}

// ---------------------------------------------------------------------------
// WHERE the 7-day window closes, and how much to trust it.
//
// The window used to close at route.generated_at, the registry refresh, which
// happens once every ~20-24 h. The rank-history shards record a fresher point
// every UTC day, and the cron runs every 4-7 h, so the published v7 could be
// almost a day old: on 2026-10-16 ruvnet/ruflo read 95.5/d while its last
// recorded week was ~139/d. The window now closes on the MOST RECENT point we
// have (the last recorded day at its capture time, or the registry count if
// that is newer) and opens on the recorded point closest to 7 days before.
export const WINDOW_DAYS = 7;
// v1/v7 above this reads "accelerating", below DECAY "cooling" (a past wave
// still inside the 7-day window, e.g. Apollo-11 at 366/d on a 76-140/d day).
export const TREND_ACCEL = 2;
export const TREND_DECAY = 0.5;
// ...and only when the day differs from the week by at least this many
// stars/day: on a slow repo the ratio is noise (json-server read "decay" on
// v1 0 vs v7 0.9).
export const TREND_MIN_ABS = 25;

const round1 = (x) => Math.round(x * 10) / 10;

// The newest measured point: { ms, stars, day } (day null for the registry).
export function windowEnd(series, capturedAt, routeStars, routeAtMs) {
  let last = null;
  for (const p of series ?? []) {
    if (p?.[2] == null) continue;
    const ms = pointMs(p[0], capturedAt);
    if (Number.isFinite(ms) && (!last || ms > last.ms)) last = { ms, stars: p[2], day: p[0] };
  }
  const reg = routeStars != null && Number.isFinite(routeAtMs) ? { ms: routeAtMs, stars: routeStars, day: null } : null;
  if (last && (!reg || last.ms > reg.ms)) return last;
  return reg ?? last;
}

// The last full day: the end point against the recorded point ~24 h before it.
// null when no point sits 12-36 h before the end (a gap is not a day), or when
// that day is a correction, not a pace: a drop of purge size, or a rise that
// gives back an earlier drop (a RESTORE, odysseus +21.8k on 2026-07-29). A
// rise with no matching drop is honest growth and stays.
export function v1For(series, capturedAt, end) {
  if (!end) return null;
  let best = null;
  for (const p of series ?? []) {
    if (p?.[2] == null) continue;
    const ms = pointMs(p[0], capturedAt);
    const age = end.ms - ms;
    if (age < 0.5 * DAY || age > 1.5 * DAY) continue;
    if (!best || Math.abs(age - DAY) < Math.abs(end.ms - best.ms - DAY)) best = { ms, stars: p[2] };
  }
  if (!best) return null;
  const delta = end.stars - best.stars;
  const big = Math.abs(delta) >= PURGE_ABS && Math.abs(delta) >= best.stars * PURGE_PCT;
  if (big && delta < 0) return null;
  if (big && delta > 0) {
    const pts = (series ?? []).filter((p) => p?.[2] != null).sort((x, y) => (x[0] < y[0] ? -1 : 1));
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i - 1][2] - pts[i][2];
      if (d >= PURGE_ABS && d >= pts[i - 1][2] * PURGE_PCT && Math.abs(d - delta) <= d * RESTORE_MATCH) return null;
    }
  }
  return round1(delta / ((end.ms - best.ms) / DAY));
}

// "accel" | "decay" | null. null means "no reason to doubt the 7-day rate" OR
// "cannot tell" (no v1, no positive v7): the trend only ever ADDS doubt.
export function trendOf(v1, v7) {
  if (v1 == null || v7 == null || !(v7 > 0)) return null;
  if (Math.abs(v1 - v7) < TREND_MIN_ABS) return null;
  const k = v1 / v7;
  if (k > TREND_ACCEL) return "accel";
  if (k < TREND_DECAY) return "decay";
  return null;
}

// One repo, end to end. `stars`/`routeAtMs` are the registry's count and
// generated_at; `series` the merged rank-history points; `capturedAt` the
// meta map. Returns null without a baseline, else v7For's fields plus:
//   v1    last full day's rate (null = not measurable)
//   v7_to ISO of the point the window closes on (the age of the rate)
//   trend "accel" | "decay" | null
export function measureRepo({ stars, routeAtMs }, series, capturedAt = null) {
  const end = windowEnd(series, capturedAt, stars, routeAtMs);
  if (!end) return null;
  const r = v7For(end.stars, series, end.ms - WINDOW_DAYS * DAY, end.ms, capturedAt);
  if (!r) return null;
  // the step sat between the last two recorded days: name the day, not "today"
  const purge = r.purge === "today" && end.day ? end.day : r.purge;
  const v1 = v1For(series, capturedAt, end);
  const trend = r.measured && !purge ? trendOf(v1, r.v7) : null;
  return { ...r, purge, v1, v7_to: new Date(end.ms).toISOString(), trend };
}

// route.v7_at: the stamp velocity7.mjs is idempotent on. The registry refresh
// OR a newly recorded day must trigger a recompute, so it is the later of both.
export function v7Stamp(generatedAt, latestCaptureIso) {
  const g = generatedAt ? Date.parse(generatedAt) : NaN;
  const c = latestCaptureIso ? Date.parse(latestCaptureIso) : NaN;
  if (!Number.isFinite(c)) return generatedAt ?? null;
  if (!Number.isFinite(g)) return new Date(c).toISOString();
  return c > g ? new Date(c).toISOString() : generatedAt;
}
