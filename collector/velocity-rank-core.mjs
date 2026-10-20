// The pure half of collector/velocity-rank.mjs: where a repo placed, day by
// day, among the worldwide top 1,000 by NEW stars that day. No network, no
// Blob: the tests pin it down, and src/lib/velocity-rank.ts imports the same
// functions so the collector and the page cannot disagree on a rank.
//
// Source: the rank-history moat (route-history shards + cold archive), one
// point per repo per recorded UTC day: [isoDay, worldRank, stars]. A day's gain
// is stars(D+1 capture) - stars(D capture), dated D. A capture runs on the
// first collect after 00:00Z that manages the sweep, in practice 00:24-04:42Z,
// so "day D" is mostly UTC day D plus the first hours of D+1, and its window
// is 20-28 h long (`hours`, stamped since 17-oct). Every repo shares the same
// two captures, so the RANK is exact whatever the window.
//
// What is left out, and why (each one a lie that never throws):
//   - a pair of days that are not consecutive: two days of stars would rank
//     against nothing comparable. The day stays a gap.
//   - a day whose sweep was truncated (2026-09-03 kept 4,039 of ~10,000), or
//     whose top 1,000 has holes: 2026-06-29 kept 9,334 points, enough for a
//     10k-count check, but ranks 10, 47, 68... were missing (shards that never
//     got the day), so every repo read 3-9% better than it was. A day counts
//     only when nearly all of world ranks 1..top were recorded on BOTH ends.
//   - a STEP: GitHub purging farmed stars or giving them back. A restore of
//     +21,863 in one day (odysseus, 2026-07-29) would sit at #1 and push every
//     real repo down a place. Same asymmetric rule as velocity7-core: any drop
//     that size is administrative, a rise only when it reverses a drop.
import { PURGE_ABS, PURGE_PCT, RESTORE_MATCH } from "./velocity7-core.mjs";

export const TOP = 1000;
// a recorded day counts when its sweep reached 90% of the top 10k, the same
// bar route-history.mjs uses before it records a day (guards.acceptUniverse)
export const MIN_UNIVERSE = 9000;
// ...and at least this share of world ranks 1..top present on the day (a few
// can be absent honestly: a repo deleted or made private between sweeps)
export const MIN_TOP_SHARE = 0.995;

const DAY = 864e5;
const nextDay = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
const bigMove = (prev, delta) => Math.abs(delta) >= PURGE_ABS && Math.abs(delta) >= prev * PURGE_PCT;

// One repo's consecutive-day gains. series = [[isoDay, rank, stars], ...] in
// any order. Returns [{ day, to, gain, rankTo, step }] for each pair of
// consecutive recorded days; `step` = "drop" | "restore" | null. Drops are
// remembered across gaps, so a restore is recognised even when the purge and
// the restore are not on adjacent days.
export function dailyDeltas(series) {
  const pts = [...(series ?? [])].filter((p) => p && typeof p[0] === "string" && Number.isFinite(p[2]))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const drops = [];
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const delta = cur[2] - prev[2];
    let step = null;
    if (bigMove(prev[2], delta)) {
      if (delta < 0) step = "drop";
      else if (drops.some((d) => Math.abs(d - delta) <= d * RESTORE_MATCH)) step = "restore";
    }
    if (step === "drop") drops.push(-delta);
    if (nextDay(prev[0]) !== cur[0]) continue;
    out.push({ day: prev[0], to: cur[0], gain: delta, rankTo: cur[1], step });
  }
  return out;
}

// The day table. seriesByRepo: iterable of [repo, series]. Returns, oldest
// first, one entry per consecutive pair of complete days:
//   { day, to, n, gains }  gains = the top-1,000's gains that day, highest
//   first (steps left out, so n can be a little under 1,000).
// The universe is the top 1,000 by stars at the CLOSE of the day (`to`).
export function buildDays(seriesByRepo, { top = TOP, minUniverse = MIN_UNIVERSE, minTopShare = MIN_TOP_SHARE } = {}) {
  const lists = [];
  const counts = new Map();
  const topRanks = new Map(); // day -> Set of world ranks <= top seen that day
  for (const [, series] of seriesByRepo) {
    for (const p of series ?? []) {
      counts.set(p[0], (counts.get(p[0]) ?? 0) + 1);
      if (p[1] <= top) {
        let s = topRanks.get(p[0]);
        if (!s) topRanks.set(p[0], (s = new Set()));
        s.add(p[1]);
      }
    }
    lists.push(series);
  }
  const complete = (d) => (counts.get(d) ?? 0) >= minUniverse && (topRanks.get(d)?.size ?? 0) >= top * minTopShare;
  const byDay = new Map();
  for (const series of lists) {
    for (const x of dailyDeltas(series)) {
      if (x.step || !(x.rankTo <= top) || !complete(x.day) || !complete(x.to)) continue;
      let e = byDay.get(x.day);
      if (!e) byDay.set(x.day, (e = { day: x.day, to: x.to, gains: [] }));
      e.gains.push(x.gain);
    }
  }
  return [...byDay.values()]
    .map((e) => ({ day: e.day, to: e.to, n: e.gains.length, gains: e.gains.sort((a, b) => b - a) }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

// 1 + how many of that day's top 1,000 gained strictly MORE. The repo's own
// gain is in the list when it was in the top 1,000, and a tie never counts
// against it, so it needs no special case; a repo outside the top 1,000 gets
// where it WOULD have placed. gains is sorted highest first.
export function rankAmong(gains, own) {
  let lo = 0;
  let hi = gains.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (gains[mid] > own) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

// One repo's daily placement across the whole table. series = the repo's
// rank-history points merged across every name it carried (a transfer must not
// open a hole). Returns one row per table day:
//   { day, rank, gain, n, inTop }   gain is NET (stars in minus stars out);
//   rank/gain null when the repo has no measurable
//   gain that day: `why` = "unrecorded" (no point on one of the two days) or
//   "step" (its own purge/restore: not a day of growth).
export function repoDailyRanks(days, series) {
  const mine = new Map(dailyDeltas(series).map((x) => [`${x.day}>${x.to}`, x]));
  return days.map((d) => {
    const x = mine.get(`${d.day}>${d.to}`);
    if (!x) return { day: d.day, rank: null, gain: null, n: d.n, why: "unrecorded" };
    if (x.step) return { day: d.day, rank: null, gain: null, n: d.n, why: "step" };
    // inTop: the repo was itself in the top 1,000 at the close of the day; if
    // not, rank is where it WOULD have placed among them
    return { day: d.day, rank: rankAmong(d.gains, x.gain), gain: x.gain, n: d.n, inTop: x.rankTo <= TOP };
  });
}
