export interface TrajectoryPoint {
  t: number;
  rank: number;
  stars: number;
}

// Daily rank-history points ([isoDay, rank, stars]) -> a time series.
// Each daily point is stamped at noon UTC, which puts TODAY's point in the
// FUTURE all morning: before 12:00 the curve ended at a time that had not
// happened, and the live "now" point landed behind it, so the series went
// backwards (caught 2026-07-28 08:26 UTC on react, next.js, mem0, odysseus -
// and invisible after midday, which is why it survived the previous day's
// checks). Clamp to now: a measurement cannot be dated later than the moment
// it was read.
export function toTrajectory(points: Iterable<[string, number, number]>, now = Date.now()): TrajectoryPoint[] {
  return [...points]
    .map(([d, rank, stars]) => ({
      t: Math.min(Date.parse(`${d}T12:00:00Z`), now),
      rank,
      stars,
    }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}
