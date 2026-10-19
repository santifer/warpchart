// ETA math with moving thresholds. Thresholds (stars of the repo at rank N)
// rise over time, so the chase speed is own velocity minus threshold drift.
import type { Neighbor } from "./types";
import { projectCrossing, type Unsteady, type VelocityQuality } from "./compare";
import { fmtEtaDays, fmtEtaRange } from "./format";
import { canonicalVelocity } from "./velocity";

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
  confidence?: "firm" | "soft" | "noisy" | "upper";
  etaRange?: { min: number; max: number } | null;
}

// THE eta to a top-N gate, on every surface (StatusBar, DailyBriefing,
// Projections, CommandDeck, both star charts, /r/ and /pricing). A gate is a
// rival like any other: the repo holding rank N, whose stars rise at `drift`
// a day. So the crossing is projectCrossing's, never a local `gap / net`: six
// hand-copied versions had drifted apart, and /pricing subtracted no drift.
// A gate already passed (live stars) is 0 days away.
export function milestoneEta(
  rank: number,
  threshold: number,
  stars: number,
  vOwn: number,
  drift: number | null
): MilestoneEta {
  const gap = Math.max(0, threshold - stars);
  if (gap === 0) return { rank, threshold, gap, drift, etaDays: 0, confidence: "firm", etaRange: null };
  // drift null = not measured yet: the gate is read as standing still, which
  // is the optimistic case, and surfaces that show drift say "calibrating"
  const x = projectCrossing(stars, vOwn, threshold, drift ?? 0);
  const reachable = x.closing > 0;
  return {
    rank,
    threshold,
    gap,
    drift,
    etaDays: reachable ? x.etaDays : null,
    confidence: x.confidence,
    etaRange: reachable ? x.etaRange : null,
  };
}

// The top-N gates of a ranked registry: rank N's stars are the threshold and
// rank N's rate is how fast it moves. /r/ and the landing demo build their
// gates here.
export function gateMilestones(
  ranked: { s: number; v?: number | null; v7?: number | null }[],
  ranks: number[],
): { rank: number; threshold: number; drift: number | null }[] {
  return ranks
    .filter((rk) => rk >= 1 && rk <= ranked.length)
    .map((rk) => ({ rank: rk, threshold: ranked[rk - 1].s, drift: gateDrift(ranked[rk - 1]) }));
}

// How fast a gate moves: the canonical rate of the repo holding that rank
// (v7 ?? v). It was hard-coded null on /r/ and the landing demo, so every
// gate stood still and every eta was optimistic: langchain at #60 read ~5
// months to the top 50 while the repo holding #50 grew five times faster.
// A gate does not fall (the next repo up takes the rank), so never below 0;
// null when the holder's rate is unknown.
export function gateDrift(holder: { v?: number | null; v7?: number | null } | null | undefined): number | null {
  const v = holder ? canonicalVelocity(holder) : null;
  return v === null ? null : Math.max(0, v);
}

export interface NeighborEta extends Neighbor {
  gap: number; // positive = ahead of us
  closing: number; // our v minus theirs; positive = we are catching up
  etaDays: number | null; // null = receding or behind us
  // a hunter: behind us AND faster; days until it catches us. The most
  // urgent number on the chart, it must never hide inside "passed".
  catchDays: number | null;
  receding: boolean;
  confidence?: "firm" | "soft" | "noisy" | "upper"; // confidence of the ETA (upper = a ceiling)
  etaRange?: { min: number; max: number } | null; // range when soft/noisy
  // set when a velocity behind the eta is shifting or stale: show the reason,
  // not a date (unsteadyLabel)
  unsteady?: Unsteady | null;
}

// `own` is OUR rate's quality (ChartInputs.vTrend / vAsOf) and `nowMs` the
// reference clock (ChartInputs.nowMs: never Date.now() in SSR state).
export function neighborEtas(
  neighbors: Neighbor[],
  stars: number,
  vOwn: number,
  own?: VelocityQuality,
  nowMs?: number,
): NeighborEta[] {
  // one projection source of truth (see compare.ts projectCrossing): the
  // scan-cards, the race chart and the OG card all meet a rival through the
  // same math, so an ETA here can never disagree with the same pair elsewhere.
  return neighbors.map((n) => {
    const x = projectCrossing(stars, vOwn, n.s, n.v, {
      a: own,
      b: { trend: n.trend ?? null, asOf: n.v7_to ?? null },
      nowMs,
    });
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
      unsteady: (isEta || isCatch) ? x.unsteady ?? null : turning(ahead && x.closing <= 0, own, n.trend ?? null),
    };
  });
}

// A receding leader is only "pulling away" while the pace behind that is
// steady. If the leader is cooling or we are accelerating, its 7-day lead in
// pace can be gone today (Apollo-11 on 16-oct: v7 336/d, last day 151, ours
// 365): say why there is no eta instead of promising the gap only grows.
function turning(
  receding: boolean,
  own: VelocityQuality | undefined,
  theirs: VelocityQuality["trend"],
): Unsteady | null {
  if (!receding) return null;
  if (theirs === "decay") return { side: "b", why: "decay", bound: null };
  if (own?.trend === "accel") return { side: "a", why: "accel", bound: null };
  return null;
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

// What to show INSTEAD of an eta whose velocity is not a pace to project
// (null when the eta stands, firm or as a ceiling). Builder-quiet, no numbers.
export function unsteadyLabel(u: Unsteady | null | undefined): string | null {
  if (!u || u.bound === "upper") return null;
  if (u.why === "stale") return u.side === "b" ? "rate over a day old" : "our rate over a day old";
  if (u.side === "b") return u.why === "accel" ? "accelerating" : "cooling";
  return u.why === "accel" ? "we are accelerating" : "we are cooling";
}

// A ceiling is rounded UP at the unit it is shown in (5.3 d is "≤6d", never
// "≤5d", which would claim more than the math does). Returns days.
export function ceilEta(days: number): number {
  if (days <= 0) return 0;
  if (days < 1) return Math.ceil(days * 24) / 24;
  return Math.ceil(days);
}

// The eta text for a neighbor: "≤6d" when the v7 eta is a ceiling, the usual
// "5d" / "~3-8d" otherwise. `days` is etaDays or catchDays.
export function etaText(n: Pick<NeighborEta, "confidence" | "etaRange">, days: number | null): string {
  if (n.confidence === "upper" && days !== null && days > 0) {
    const c = ceilEta(days);
    if (c < 1) return "≤" + Math.round(c * 24) + "h";
    if (c < 60) return "≤" + c + "d";
    if (c < 365) return "≤" + Math.ceil(c / 30.44) + "mo";
    return "≤" + fmtEtaDays(c);
  }
  return fmtEtaRange(days, n.etaRange);
}

// A neighbor's worldwide rank, derived from OUR live rank and the neighbors'
// stars, never from the daily registry (RouteRepo.rank). The collector takes
// the neighbors from the same GitHub search that counts our rank: the 15
// repos right above and the 5 right below, contiguous. So a neighbor's rank
// is ours minus the neighbors between us. The registry is up to a day old: on
// 2026-10-19 the header said #250 while the scan card put LlamaFactory, 11
// stars above us, at #247 (two repos had passed both since the snapshot).
// null = not one of the neighbors or no rank of our own: the caller falls
// back to the dated registry figure.
export function neighborRank(
  neighbors: Pick<Neighbor, "r" | "s">[],
  stars: number,
  rank: number | null,
  repo: string,
): number | null {
  if (!rank) return null;
  const n = neighbors.find((m) => m.r.toLowerCase() === repo.toLowerCase());
  if (!n) return null;
  if (n.s > stars) return rank - neighbors.filter((m) => m.s > stars && m.s <= n.s).length;
  return rank + neighbors.filter((m) => m.s <= stars && m.s >= n.s).length;
}
