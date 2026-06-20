// THE single definition of canonical growth velocity for a route/catalog repo.
//
// Stars/day comes in two flavours: the stable trailing 7-day rate (v7, from the
// rank-history moat) and the noisy ~1-day registry diff (v). v7 is CANONICAL;
// v is only a fallback while a repo has no 7-day baseline yet. Every display and
// ranking surface (home, /velocity, /c, /find, the badges, the explorer chart,
// the public API) MUST read velocity through here, so the same repo can never
// show two different stars/day on two pages — the contradiction the methodology
// page promises does not exist ("the headline velocity is a trailing 7-day rate").
//
// Pure, dependency-free: safe to import from server data prep AND client charts.
export interface HasVelocity {
  v?: number | null;
  v7?: number | null;
}

// Canonical stars/day, or null when neither rate is known yet.
export const canonicalVelocity = (p: HasVelocity): number | null => p.v7 ?? p.v ?? null;

// Canonical stars/day for ranking, gates and aggregation: never negative, never
// null (a missing or negative rate counts as zero momentum).
export const canonicalVel0 = (p: HasVelocity): number => Math.max(0, p.v7 ?? p.v ?? 0);
