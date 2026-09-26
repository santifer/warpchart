// The pure half of collector/velocity7.mjs: how a trailing 7-day rate is
// measured from the rank-history series, including the star-purge and
// restore steps that once published -2903/d and then +4587/d for a repo that
// was really growing ~120/d. No network, no Blob: the tests pin it down.

const DAY = 864e5;

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
export function baselineFor(series, targetMs, todayMs, currentStars = null) {
  const pts = series
    .map((p) => [Date.parse(`${p[0]}T12:00:00Z`), p[2], p[0]])
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
export function v7For(stars, series, targetMs, todayMs) {
  const base = baselineFor(series, targetMs, todayMs, stars);
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
