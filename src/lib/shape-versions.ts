// SHAPE VERSIONS: one number per cached type, and every unstable_cache key is
// DERIVED from them. `unstable_cache` survives a deploy, so an entry cached
// under the old shape does not fail: it serves the old reading, and the deploy
// that fixed a number ships looking like it did nothing. Keys used to be bumped
// by hand, and a key that EMBEDS another type (explorer-data holds a Dossier)
// had to be remembered too. It was not, more than once ("Third time this exact
// miss has cost a deploy").
//
// The rule: change a type's shape (or the meaning of a field), bump ITS number
// here, in the same commit. Every key that embeds it moves with it.
//
// No imports on purpose: every cached module imports this one.

export const SHAPE_VERSION = {
  // Dossier (src/lib/explorer.ts)
  // v8: invalidate entries cached by the short-lived npm total-cap that stored
  // a null npm. v9: entries stored while both channels were truncated to the
  // slowest one hold clone days already discarded at write time. v10: the
  // 30-day-total shape (uniqueCloners30, no clonesHistory) was live for about
  // an hour. v11: uniqueCloners14d. v15: npmLast30MissingDays/npmLast30Estimate,
  // npm holes dropped from npmHistory. v16: vitals contributors = GitHub's
  // sidebar count, may be null. v17: npmLatest.
  dossier: 17,
  // ExplorerData's own fields, ChartInputs and Neighbor (src/lib/explorer.ts,
  // src/lib/types.ts). v2/v3 were dossier bumps it had to copy by hand;
  // v4: neighbors gained trend/v7_to and inputs vTrend/vAsOf.
  explorerData: 4,
  // Vitals (src/lib/vitals.ts). v7: sample counts passing for totals. v8:
  // onboarding.goodFirstIssuesFree. v9: contributors = GitHub's sidebar.
  // v10: census.githubDaily.
  vitals: 10,
  // TrafficVault (src/lib/traffic.ts). v2: newestDay. v3: alias-merged reads,
  // cached under the canonical name. v4: ciBand per day + ci (the CI band of
  // the clone series).
  trafficVault: 4,
  // PrFlow (src/lib/prflow.ts)
  prFlow: 1,
  // Curve (src/lib/curve.ts). v2: seam-anchored archive normalization. v3:
  // per-repo tags + live total. v4: exact daily recent tail from rank-history.
  // v5: cascade that never 502s. v6: daily points clamped to now.
  curve: 6,
  // the monthly OSS Insight series (src/lib/curve.ts)
  archiveMonthly: 1,
  // a builders-wall SVG (src/app/api/builders/route.ts)
  buildersWall: 2,
  // the daily velocity-rank table (src/lib/velocity-rank.ts): its meta, one
  // month of days, and the reconstructed days before the live record
  velocityRankMeta: 2,
  velocityRankMonth: 2,
  // v3: the window runs to 30 Sep (gap fill)
  velocityRankReconstructed: 3,
} as const;

export type ShapeType = keyof typeof SHAPE_VERSION;

// Each cached value: its key prefix and the OTHER types stored inside it.
// A type embedded here makes its version part of this key.
const CACHED: Record<ShapeType, { prefix: string; embeds: ShapeType[] }> = {
  dossier: { prefix: "dossier", embeds: [] },
  explorerData: { prefix: "explorer-data", embeds: ["dossier"] },
  vitals: { prefix: "vitals", embeds: [] },
  trafficVault: { prefix: "traffic-vault", embeds: [] },
  prFlow: { prefix: "prflow", embeds: [] },
  curve: { prefix: "embed-chart-curve", embeds: [] },
  archiveMonthly: { prefix: "archive-monthly", embeds: [] },
  buildersWall: { prefix: "builders-wall", embeds: [] },
  velocityRankMeta: { prefix: "velocity-rank-meta", embeds: [] },
  velocityRankMonth: { prefix: "velocity-rank-month", embeds: [] },
  velocityRankReconstructed: { prefix: "velocity-rank-reconstructed", embeds: [] },
};

// Every type reachable from `type` through what it embeds, excluding itself.
function embedded(type: ShapeType, seen = new Set<ShapeType>()): ShapeType[] {
  for (const e of CACHED[type].embeds) {
    if (seen.has(e) || e === type) continue;
    seen.add(e);
    embedded(e, seen);
  }
  return [...seen].sort();
}

// "dossier-v17"; "explorer-data-v4.dossier17". A key with nothing embedded
// keeps the exact string it had when it was bumped by hand, so this change
// itself leaves those caches warm.
export function cacheKey(type: ShapeType, versions: Record<ShapeType, number> = SHAPE_VERSION): string {
  const own = `${CACHED[type].prefix}-v${versions[type]}`;
  return [own, ...embedded(type).map((e) => `${e}${versions[e]}`)].join(".");
}
