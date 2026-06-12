// Freshness policy for the README embeds (badge + chart). Two layers of
// cache sit between us and the reader (our edge + GitHub's Camo proxy), so
// the precision we SHOW must never exceed the freshness we can deliver:
// generic repos get a rounded counter that cannot be caught lying, and the
// edge TTL adapts to each repo's measured velocity -- the cache expires at
// half the time the display takes to move one visible step.

// "52.9K": one decimal up to 100K keeps the counter feeling alive without
// promising star-level precision we don't refresh for generic repos.
export function fmtEmbed(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/0$/, "").replace(/\.0$/, "") + "M";
  if (n >= 100_000) return Math.round(n / 1000) + "K";
  if (n >= 1_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

// Smallest star delta that changes what fmtEmbed renders at this magnitude.
export function displayStep(n: number): number {
  if (n >= 1_000_000) return 10_000;
  if (n >= 100_000) return 1_000;
  if (n >= 1_000) return 100;
  return 1;
}

// Seconds the edge may serve this embed: half the time the rounded display
// takes to change, so a 2-star/day repo caches for a day while a viral one
// refreshes every 15 minutes. Unknown velocity falls back to 30 minutes.
export function adaptiveTtl(total: number, vPerDay: number | null | undefined): number {
  if (!vPerDay || vPerDay <= 0) return 1800;
  const daysPerStep = displayStep(total) / vPerDay;
  return Math.round(Math.min(86_400, Math.max(900, daysPerStep * 86_400 * 0.5)));
}

// max-age caps at 1h so browsers/Camo come back even when our edge holds
// a day-long entry for a slow repo.
export function embedCache(ttl: number, swr = 86_400): string {
  return `public, max-age=${Math.min(ttl, 3600)}, s-maxage=${ttl}, stale-while-revalidate=${swr}`;
}

// The tenant embed promises an EXACT counter, so it gets the opposite
// trade: short TTL, short grace.
export const TENANT_EMBED_CACHE = embedCache(900, 3600);
