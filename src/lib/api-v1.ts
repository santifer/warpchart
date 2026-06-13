// Cache-only data shaping for the public /api/v1 surface (and the MCP server +
// CLI built on top of it). Reads ONLY the committed / Blob-hydrated worldwide
// registry (data/route.json) and the daily collision scan (data/collisions.json).
// It NEVER triggers a GitHub fetch: every field here is already paid for by the
// collector, so traffic is free. The line stays public-and-free; per-tenant
// history is a separate, gated surface.
import { loadRoute, loadCollisions } from "@/lib/history";

export const SITE = "https://warpchart.dev";

// round-rank milestone gates, ascending
const GATES = [1, 3, 5, 10, 25, 50, 100, 200, 300, 400, 500, 750, 1000];

export interface RegistryMeta {
  size: number;
  asOf: string | null;
}

export function registryMeta(): RegistryMeta {
  const r = loadRoute();
  return { size: r?.repos.length ?? 0, asOf: r?.generated_at ?? null };
}

export interface NeighborStat {
  repo: string;
  rank: number;
  stars: number;
  gap: number; // their stars minus ours (positive = ahead)
  velocityPerDay: number | null;
}

export interface RepoStats {
  repo: string;
  rank: number;
  stars: number;
  velocityPerDay: number | null;
  language: string | null;
  forks: number | null;
  ahead: NeighborStat[];
  behind: NeighborStat[];
  nextGate: { rank: number; threshold: number; gap: number } | null;
  url: string;
}

// Worldwide rank + neighbours for a repo IN the top-1000 registry. Returns null
// for anything outside it (honest: we do not live-fetch deep space here).
export function repoStats(repoInput: string, band = 5): RepoStats | null {
  const r = loadRoute();
  if (!r) return null;
  const lower = repoInput.toLowerCase();
  const idx = r.repos.findIndex((p) => p.r.toLowerCase() === lower);
  if (idx === -1) return null;
  const me = r.repos[idx];
  const rank = idx + 1;

  const slice = (from: number, to: number): NeighborStat[] => {
    const start = Math.max(0, from);
    return r.repos.slice(start, to).map((p, k) => ({
      repo: p.r,
      rank: start + k + 1,
      stars: p.s,
      gap: p.s - me.s,
      velocityPerDay: p.v ?? null,
    }));
  };
  const ahead = slice(idx - band, idx).reverse(); // closest ahead first
  const behind = slice(idx + 1, idx + 1 + band);

  // next round-rank gate above us (a smaller rank number), with its star
  // threshold = the stars of the repo currently holding that rank
  const gateRank = GATES.filter((g) => g < rank).pop() ?? null;
  let nextGate: RepoStats["nextGate"] = null;
  if (gateRank && r.repos[gateRank - 1]) {
    const threshold = r.repos[gateRank - 1].s;
    nextGate = { rank: gateRank, threshold, gap: Math.max(0, threshold - me.s) };
  }

  return {
    repo: me.r,
    rank,
    stars: me.s,
    velocityPerDay: me.v ?? null,
    language: me.l ?? null,
    forks: me.f ?? null,
    ahead,
    behind,
    nextGate,
    url: `${SITE}/r/${me.r}`,
  };
}

export interface VelocityEntry {
  repo: string;
  rank: number;
  stars: number;
  velocityPerDay: number;
  language: string | null;
}

export function velocityRanking(limit = 20): VelocityEntry[] {
  const r = loadRoute();
  if (!r) return [];
  return r.repos
    .map((p, i) => ({
      repo: p.r,
      rank: i + 1,
      stars: p.s,
      velocityPerDay: p.v ?? 0,
      language: p.l ?? null,
    }))
    .filter((p) => p.velocityPerDay > 0)
    .sort((a, b) => b.velocityPerDay - a.velocityPerDay)
    .slice(0, Math.max(1, Math.min(limit, 200)));
}

export interface Overtake {
  hunter: { repo: string; rank: number; stars: number; velocityPerDay: number };
  victim: { repo: string; rank: number; stars: number; velocityPerDay: number };
  gap: number;
  etaDays: number;
  eta: string;
  sameLanguage: boolean;
  url: string;
}

export function overtakes(limit = 20): Overtake[] {
  const c = loadCollisions();
  if (!c) return [];
  return c.collisions.slice(0, Math.max(1, Math.min(limit, 200))).map((x) => ({
    hunter: { repo: x.hunter.r, rank: x.hunter.rank, stars: x.hunter.s, velocityPerDay: x.hunter.v },
    victim: { repo: x.victim.r, rank: x.victim.rank, stars: x.victim.s, velocityPerDay: x.victim.v },
    gap: x.gap,
    etaDays: x.etaDays,
    eta: x.eta,
    sameLanguage: x.sameLang,
    url: `${SITE}/r/${x.victim.r}`,
  }));
}

export function compareRepos(repos: string[]): { repo: string; stats: RepoStats | null }[] {
  return repos.slice(0, 10).map((repo) => ({ repo, stats: repoStats(repo, 0) }));
}

export interface EmbedSnippet {
  repo: string;
  chartUrl: string;
  pageUrl: string;
  markdown: string;
  html: string;
}

// The README embed (animated SVG star chart) — returning this from the API
// closes the loop: a query becomes an installed embed pointing back to us.
export function embedSnippet(repo: string): EmbedSnippet {
  const chartUrl = `${SITE}/api/chart?repo=${encodeURIComponent(repo)}`;
  const pageUrl = `${SITE}/r/${repo}`;
  return {
    repo,
    chartUrl,
    pageUrl,
    markdown: `[![${repo} star history · Warpchart](${chartUrl})](${pageUrl})`,
    html: `<a href="${pageUrl}"><img src="${chartUrl}" alt="${repo} star history · Warpchart" /></a>`,
  };
}
