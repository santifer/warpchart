// Shared, pure helpers for the multi-repo comparison ("the race"): used by the
// client lab AND the server OG card, so the math stays identical in both.
// No DOM, no React — safe on the edge.

export interface CurvePoint {
  t: number;
  v: number;
}

export const DAY = 86_400_000;

// Distinct, dark-readable series colors. Index 0 is the brand cyan, so the
// first repo (career-ops by default) reads as "ours".
export const SERIES_COLORS = [
  "#53d6e8", // cyan (brand)
  "#f2a33c", // amber
  "#6ee7a8", // mint
  "#c084fc", // violet
  "#fb7185", // rose
  "#fbbf24", // gold
  "#7dd3fc", // sky
  "#a3e635", // lime
];

export function repoColor(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length];
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

// Parse a comma-separated repo list from the URL: validated, de-duped (case
// insensitive), capped. Order is preserved (it drives series color).
export function parseRepos(raw: string | null | undefined, max = 8): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const r = part.trim();
    if (!r || !REPO_RE.test(r)) continue;
    const key = r.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

// Linear-interpolated value of a monotonic (t-ascending) cumulative curve at
// time t. null before the repo existed; flat at the last value after its last
// point (so an overlay never invents future stars).
export function valueAt(pts: CurvePoint[], t: number): number | null {
  if (!pts.length) return null;
  if (t <= pts[0].t) return t < pts[0].t ? null : pts[0].v;
  const last = pts[pts.length - 1];
  if (t >= last.t) return last.v;
  // strictly inside (pts[0].t < t < last.t); lo starts at 1 so pts[lo-1] is
  // always valid even when t lands exactly on an interior point.
  let lo = 1;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const b = pts[lo];
  const a = pts[lo - 1];
  const k = (t - a.t) / Math.max(1, b.t - a.t);
  return a.v + (b.v - a.v) * k;
}

// The most RECENT overtake between two cumulative curves, within the time
// range they overlap. This is the dramatic moment the race is about.
export function lastCrossover(
  a: CurvePoint[],
  b: CurvePoint[],
): { t: number; leader: "a" | "b" } | null {
  if (a.length < 2 || b.length < 2) return null;
  const t0 = Math.max(a[0].t, b[0].t);
  const t1 = Math.min(a[a.length - 1].t, b[b.length - 1].t);
  if (t1 <= t0) return null;
  const N = 96;
  let prevSign = 0;
  let last: { t: number; leader: "a" | "b" } | null = null;
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N;
    const d = (valueAt(a, t) ?? 0) - (valueAt(b, t) ?? 0);
    const sign = d > 0 ? 1 : d < 0 ? -1 : 0;
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) {
      last = { t, leader: sign > 0 ? "a" : "b" };
    }
    if (sign !== 0) prevSign = sign;
  }
  return last;
}

// Trailing stars/day at time t over a window (default 7d): the "growth rate"
// view that star-history cannot show.
export function rateAt(pts: CurvePoint[], t: number, windowMs = 7 * DAY): number {
  const t0 = pts.length ? pts[0].t : t;
  const from = Math.max(t0, t - windowMs);
  const v = valueAt(pts, t);
  const vPrev = valueAt(pts, from);
  if (v === null || vPrev === null) return 0;
  const days = (t - from) / DAY;
  return days > 0 ? Math.max(0, (v - vPrev) / days) : 0;
}

// THE single projection. When does repo A meet repo B, given their current
// star counts and per-day velocities? Pure, now-independent (callers add the
// date as `now + etaDays*DAY`), so the race chart, the neighbor scan-cards, the
// OG card and the API all read ONE source of truth and cannot contradict each
// other. A meeting exists only when the currently-BEHIND repo is the faster
// one (it is closing the gap); a parallel or diverging pair returns null.
//
// `confidence` flags how trustworthy the single number is: eta = gap/closing is
// hypersensitive when `closing` is small, so a near-tie projected far out is
// "noisy" and the UI should show a band, not a hard date (the honesty layer).
export interface Crossing {
  gap: number; // bStars - aStars (positive = B is ahead of A)
  closing: number; // aVel - bVel (positive = A is gaining on B)
  etaDays: number | null; // days until they meet (>= 0); null = not converging
  confidence: "firm" | "soft" | "noisy";
  etaRange?: { min: number; max: number } | null; // range when soft/noisy; null if not applicable
}

export function projectCrossing(
  aStars: number,
  aVel: number,
  bStars: number,
  bVel: number,
): Crossing {
  const gap = bStars - aStars;
  const closing = Math.round((aVel - bVel) * 10) / 10;
  // converging iff the behind repo is faster: gap>0 needs closing>0 (A catches
  // B), gap<0 needs closing<0 (B catches A); either way gap/closing >= 0.
  let etaDays: number | null = null;
  if (gap === 0) etaDays = 0;
  else if (gap > 0 && closing > 0) etaDays = gap / closing;
  else if (gap < 0 && closing < 0) etaDays = gap / closing;
  etaDays = etaDays === null ? null : Math.round(etaDays * 10) / 10;

  let confidence: Crossing["confidence"] = "firm";
  if (etaDays === null) confidence = "noisy";
  else if (Math.abs(closing) < 3 || etaDays > 25) confidence = "noisy";
  else if (etaDays > 8) confidence = "soft";

  // Calculate confidence range for soft/noisy projections
  let etaRange: { min: number; max: number } | null = null;
  if (etaDays !== null && (confidence === "soft" || confidence === "noisy")) {
    // soft: ±40% band around the point estimate
    // noisy: ±60% band (wider uncertainty)
    const pct = confidence === "soft" ? 0.4 : 0.6;
    const delta = Math.max(1, Math.round(etaDays * pct));
    etaRange = {
      min: Math.max(0, Math.round((etaDays - delta) * 10) / 10),
      max: Math.round((etaDays + delta) * 10) / 10,
    };
  }

  return { gap, closing, etaDays, confidence, etaRange };
}

export function shortRepo(repo: string): string {
  return repo.includes("/") ? repo.split("/")[1] : repo;
}
