// ETA math with moving thresholds. Thresholds (stars of the repo at rank N)
// rise over time, so the chase speed is own velocity minus threshold drift.
import type { Neighbor } from "./types";

const DAY = 86_400_000;

// Least-squares slope in units/day. Returns null when the sample is too thin
// to be meaningful (fewer than 6 points or less than 12h of span).
export function driftPerDay(points: { t: number; y: number }[]): number | null {
  if (points.length < 6) return null;
  const span = points[points.length - 1].t - points[0].t;
  if (span < DAY / 2) return null;
  const n = points.length;
  const xs = points.map((p) => p.t / DAY);
  const ys = points.map((p) => p.y);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  return Math.round((num / den) * 10) / 10;
}

export interface MilestoneEta {
  rank: number;
  threshold: number;
  gap: number;
  drift: number | null; // null = still calibrating
  etaDays: number | null; // null = not reachable at current pace
}

export function milestoneEta(
  rank: number,
  threshold: number,
  stars: number,
  vOwn: number,
  drift: number | null
): MilestoneEta {
  const gap = Math.max(0, threshold - stars);
  const net = vOwn - (drift ?? 0);
  const etaDays = gap === 0 ? 0 : net > 0 ? Math.round((gap / net) * 10) / 10 : null;
  return { rank, threshold, gap, drift, etaDays };
}

export interface NeighborEta extends Neighbor {
  gap: number; // positive = ahead of us
  closing: number; // our v minus theirs; positive = we are catching up
  etaDays: number | null; // null = receding or behind us
  // a hunter: behind us AND faster; days until it catches us. The most
  // urgent number on the chart, it must never hide inside "passed".
  catchDays: number | null;
  receding: boolean;
}

export function neighborEtas(neighbors: Neighbor[], stars: number, vOwn: number): NeighborEta[] {
  return neighbors.map((n) => {
    const gap = n.s - stars;
    const closing = Math.round((vOwn - n.v) * 10) / 10;
    const ahead = gap > 0;
    const etaDays = ahead && closing > 0 ? Math.round((gap / closing) * 10) / 10 : null;
    const catchDays = !ahead && closing < 0 ? Math.round((gap / closing) * 10) / 10 : null;
    return { ...n, gap, closing, etaDays, catchDays, receding: ahead && closing <= 0 };
  });
}
