// Status comparisons for the Command Deck tiles. Each number is compared with
// its OWN recent past (no invented thresholds): up is good, down is a warning,
// and a missing baseline is null, never zero.
//
// Contract (AGENTS.md):
// 1. Decision: is this number moving the right way right now?
// 2. Counts: RANK = positions gained since the last snapshot at or before
//    now-7d. WEEK = stars in the last 7 COMPLETE UTC days vs the 7 before,
//    as a rounded percent. Today's partial day is never in either window.
// 3. Dated by the snapshots / stargazer timestamps, not by the fetch.
// 4. Fails as null: no snapshot within 7-8 days back, fewer than 14 complete
//    days, or an empty prior week (a percent of zero is not a number).
// 5. Seen in the deck's RANK and V7D tiles (client, no cache key).
// 6. Verified by deck-deltas.test.ts against hand-built series.
import type { DayPoint, RankPoint } from "./types";

const DAY = 864e5;

export function rankDelta7d(history: RankPoint[], nowRank: number | null, nowMs: number): number | null {
  if (nowRank === null) return null;
  const target = nowMs - 7 * DAY;
  // the newest snapshot at or before now-7d, and not older than 8 days
  let base: RankPoint | null = null;
  for (const p of history) {
    if (p.t <= target && (!base || p.t > base.t)) base = p;
  }
  if (!base || base.t < nowMs - 8 * DAY) return null;
  return base.rank - nowRank; // positive = climbed
}

export function weekOverWeekPct(daily: DayPoint[], nowMs: number): number | null {
  const todayKey = new Date(nowMs).toISOString().slice(0, 10);
  const done = daily.filter((p) => p.d < todayKey);
  if (done.length < 14) return null;
  const sum = (xs: DayPoint[]) => xs.reduce((a, p) => a + p.c, 0);
  const last = sum(done.slice(-7));
  const prior = sum(done.slice(-14, -7));
  if (prior <= 0) return null;
  return Math.round(((last - prior) / prior) * 100);
}
