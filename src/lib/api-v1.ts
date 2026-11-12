// Cache-only data shaping for the public /api/v1 surface (and the MCP server +
// CLI built on top of it). Reads ONLY the committed / Blob-hydrated worldwide
// registry (data/route.json) and the daily collision scan (data/collisions.json).
// It NEVER triggers a GitHub fetch: every field here is already paid for by the
// collector, so traffic is free. The line stays public-and-free; per-tenant
// history is a separate, gated surface.
import { loadRoute, loadCollisions } from "@/lib/history";
import { canonicalRepo } from "@/lib/aliases";
import { repoBadges } from "@/lib/badges";
import { canonicalVelocity, canonicalVel0 } from "@/lib/velocity";
import { rankedRegistry } from "@/lib/rank";

export const SITE = "https://warpchart.dev";

// round-rank milestone gates, ascending
const GATES = [1, 3, 5, 10, 25, 50, 100, 200, 300, 400, 500, 750, 1000];

const clamp = (n: number) => Math.max(1, Math.min(Math.floor(n) || 20, 200));

// stars/day shown to a consumer are whole numbers (a star count never carries
// decimals); the canonical v7/v can be fractional, so round at the API boundary.
const rnd = (v: number | null | undefined): number | null => (v == null ? null : Math.round(v));

export interface RegistryMeta {
  size: number;
  asOf: string | null; // when the registry's star counts were taken
  // when the velocities were computed (route.v7_at): later than asOf when a
  // newer rank-history day closed the 7-day window after the registry refresh
  velocityAsOf: string | null;
}

export function registryMeta(): RegistryMeta {
  const r = loadRoute();
  return { size: r?.repos.length ?? 0, asOf: r?.generated_at ?? null, velocityAsOf: r?.v7_at ?? r?.generated_at ?? null };
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
  classifications: { key: string; label: string; kind: "class" | "designation" }[];
  url: string;
}

// Worldwide rank + neighbours for a repo IN the top-1000 registry. Returns null
// for anything outside it (honest: we do not live-fetch deep space here).
export function repoStats(repoInput: string, band = 5): RepoStats | null {
  const route = loadRoute();
  if (!route) return null;
  // counted ranks in current star order (src/lib/rank.ts): the rank, the
  // neighbors and the gate all agree with the stars they print
  const repos = rankedRegistry(route.repos);
  // A renamed repo's old name resolves to its canonical name. Nothing else
  // does: the name-part fallback that lived here resolved "alice/react" to the
  // registry's "*/react" and served another repo's record under her label.
  const lower = canonicalRepo(repoInput).toLowerCase();
  const idx = repos.findIndex((p) => p.r.toLowerCase() === lower);
  if (idx === -1) return null;
  const me = repos[idx];
  const rank = me.rank;

  const slice = (from: number, to: number): NeighborStat[] => {
    const start = Math.max(0, from);
    return repos.slice(start, to).map((p) => ({
      repo: p.r,
      rank: p.rank,
      stars: p.s,
      gap: p.s - me.s,
      velocityPerDay: rnd(canonicalVelocity(p)),
    }));
  };
  const ahead = slice(idx - band, idx).reverse(); // closest ahead first
  const behind = slice(idx + 1, idx + 1 + band);

  // next round-rank gate above us (a smaller rank number), with its star
  // threshold = the stars of the repo currently holding that rank
  const gateRank = GATES.filter((g) => g < rank).pop() ?? null;
  let nextGate: RepoStats["nextGate"] = null;
  if (gateRank && repos[gateRank - 1]) {
    const threshold = repos[gateRank - 1].s;
    nextGate = { rank: gateRank, threshold, gap: Math.max(0, threshold - me.s) };
  }

  return {
    repo: me.r,
    rank,
    stars: me.s,
    velocityPerDay: rnd(canonicalVelocity(me)),
    language: me.l ?? null,
    forks: me.f ?? null,
    ahead,
    behind,
    nextGate,
    classifications: (() => {
      const bd = repoBadges(me.r);
      return [...(bd.klass ? [bd.klass] : []), ...bd.designations].map((b) => ({
        key: b.key,
        label: b.label,
        kind: b.kind,
      }));
    })(),
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

// Fastest movers (stars/day), optionally filtered to one language.
export function velocityRanking(limit = 20, language?: string): VelocityEntry[] {
  const r = loadRoute();
  if (!r) return [];
  const lang = language?.trim().toLowerCase();
  return rankedRegistry(r.repos)
    .map((p) => ({ repo: p.r, rank: p.rank, stars: p.s, velocityPerDay: Math.round(canonicalVel0(p)), language: p.l ?? null }))
    .filter((p) => p.velocityPerDay > 0 && (!lang || (p.language ?? "").toLowerCase() === lang))
    .sort((a, b) => b.velocityPerDay - a.velocityPerDay)
    .slice(0, clamp(limit));
}

// The worldwide leaderboard: biggest repos by stars, optionally by language,
// in current star order with counted ranks.
// CSV serialization of a velocity/leaderboard table, for investor and builder
// workflows (the GitDealFlow-style JSON-or-CSV feed promised on the Warp Index).
export function velocityCsv(rows: VelocityEntry[]): string {
  const head = "rank,repo,stars,velocity_per_day,language";
  const cell = (v: string | number | null) => String(v ?? "").replace(/[,\r\n]/g, " ");
  const body = rows
    .map((r) => [r.rank, r.repo, r.stars, r.velocityPerDay, cell(r.language)].join(","))
    .join("\n");
  return `${head}\n${body}\n`;
}

export function leaderboard(limit = 20, language?: string): VelocityEntry[] {
  const r = loadRoute();
  if (!r) return [];
  const lang = language?.trim().toLowerCase();
  return rankedRegistry(r.repos)
    .map((p) => ({ repo: p.r, rank: p.rank, stars: p.s, velocityPerDay: Math.round(canonicalVel0(p)), language: p.l ?? null }))
    .filter((p) => !lang || (p.language ?? "").toLowerCase() === lang)
    .slice(0, clamp(limit));
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

type Collision = NonNullable<ReturnType<typeof loadCollisions>>["collisions"][number];
function mapCollision(x: Collision): Overtake {
  return {
    hunter: { repo: x.hunter.r, rank: x.hunter.rank, stars: x.hunter.s, velocityPerDay: x.hunter.v },
    victim: { repo: x.victim.r, rank: x.victim.rank, stars: x.victim.s, velocityPerDay: x.victim.v },
    gap: x.gap,
    etaDays: x.etaDays,
    eta: x.eta,
    sameLanguage: x.sameLang,
    url: `${SITE}/r/${x.victim.r}`,
  };
}

export function overtakes(limit = 20): Overtake[] {
  const c = loadCollisions();
  if (!c) return [];
  return c.collisions.slice(0, clamp(limit)).map(mapCollision);
}

export interface RepoOvertakes {
  repo: string;
  hunters: Overtake[]; // repos about to pass THIS repo (it is the victim)
  targets: Overtake[]; // repos THIS repo is about to pass (it is the hunter)
}

// The competitive picture for one repo: who is hunting it, and who it hunts.
// This is the "who is chasing my repo?" answer the launch leads with.
export function repoOvertakes(repoInput: string): RepoOvertakes {
  const c = loadCollisions();
  const lower = canonicalRepo(repoInput).toLowerCase();
  const all = c?.collisions ?? [];
  return {
    repo: repoInput,
    hunters: all.filter((x) => x.victim.r.toLowerCase() === lower).map(mapCollision),
    targets: all.filter((x) => x.hunter.r.toLowerCase() === lower).map(mapCollision),
  };
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
