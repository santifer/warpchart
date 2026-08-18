// ETA math with moving thresholds. Thresholds (stars of the repo at rank N)
// rise over time, so the chase speed is own velocity minus threshold drift.
import type { Neighbor } from "./types";
import { projectCrossing } from "./compare";

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
  confidence?: "firm" | "soft" | "noisy";
  etaRange?: { min: number; max: number } | null;
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

  // confidence similar to projectCrossing
  let confidence: MilestoneEta["confidence"] = "firm";
  if (etaDays === null) confidence = "noisy";
  else if (net < 3 || etaDays > 25) confidence = "noisy";
  else if (etaDays > 8) confidence = "soft";

  // Calculate range for soft/noisy projections
  let etaRange: { min: number; max: number } | null = null;
  if (etaDays !== null && (confidence === "soft" || confidence === "noisy")) {
    const pct = confidence === "soft" ? 0.4 : 0.6;
    const delta = Math.max(1, Math.round(etaDays * pct));
    etaRange = {
      min: Math.max(0, Math.round((etaDays - delta) * 10) / 10),
      max: Math.round((etaDays + delta) * 10) / 10,
    };
  }

  return { rank, threshold, gap, drift, etaDays, confidence, etaRange };
}

export interface NeighborEta extends Neighbor {
  gap: number; // positive = ahead of us
  closing: number; // our v minus theirs; positive = we are catching up
  etaDays: number | null; // null = receding or behind us
  // a hunter: behind us AND faster; days until it catches us. The most
  // urgent number on the chart, it must never hide inside "passed".
  catchDays: number | null;
  receding: boolean;
  confidence?: "firm" | "soft" | "noisy"; // confidence of the ETA
  etaRange?: { min: number; max: number } | null; // range when soft/noisy
}

export function neighborEtas(neighbors: Neighbor[], stars: number, vOwn: number): NeighborEta[] {
  // one projection source of truth (see compare.ts projectCrossing): the
  // scan-cards, the race chart and the OG card all meet a rival through the
  // same math, so an ETA here can never disagree with the same pair elsewhere.
  return neighbors.map((n) => {
    const x = projectCrossing(stars, vOwn, n.s, n.v);
    const ahead = x.gap > 0;
    const isEta = ahead && x.closing > 0; // we pass them
    const isCatch = !ahead && x.closing < 0; // they catch us
    return {
      ...n,
      gap: x.gap,
      closing: x.closing,
      etaDays: isEta ? x.etaDays : null,
      catchDays: isCatch ? x.etaDays : null,
      receding: ahead && x.closing <= 0,
      confidence: x.confidence,
      etaRange: (isEta || isCatch) ? x.etaRange : null,
    };
  });
}

// A milestone the repo has already passed is not a projection, it is history:
// the Mission Log records the crossing and the panel should be pointing at what
// is next. Thresholds MOVE (the repo holding rank N keeps gaining stars), so a
// gate can legitimately go back to being ahead of you after you crossed it, and
// this filter re-adds it on its own when that happens.
//
// Filtered against the LIVE star count, not the snapshot's: the gate must clear
// the moment it is truly cleared, not on the collector's next pass.
export function pendingMilestones<T extends { threshold: number }>(
  milestones: T[],
  liveStars: number
): T[] {
  return milestones.filter((m) => m.threshold > liveStars);
}
