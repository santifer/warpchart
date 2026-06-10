// Data assembly for the instant explorer (/r/owner/name): a live snapshot of
// ANY GitHub repo's position on the route, with tiered cost:
//   - repo in the precomputed top 1000 -> 1 GraphQL call (velocities only)
//   - deep space -> ~5 calls (meta, rank, 2 searches, velocities)
// Pages are ISR-cached, so cost stays flat regardless of traffic.
import { loadRoute } from "./history";
import { repoLite, worldwideRank, searchNeighbors, neighborsVelocity } from "./github";
import { nextMilestones } from "./milestones";
import { buildRouteLayers } from "./bundle";
import type { ChartInputs, Neighbor, RouteRepo } from "./types";

export interface ExplorerData {
  inputs: ChartInputs;
  desc: string | null;
  lang: string | null;
  neighbors: Neighbor[];
  inTop1000: boolean;
  generatedAt: string;
}

export async function getExplorerData(owner: string, name: string): Promise<ExplorerData | null> {
  const full = `${owner}/${name}`;
  if (!/^[\w.-]+\/[\w.-]+$/.test(full)) return null;

  const route = loadRoute();
  const ranked: RouteRepo[] = (route?.repos ?? []).map((p, i) => ({ ...p, rank: i + 1 }));
  if (!ranked.length) return null;

  const idx = ranked.findIndex((p) => p.r.toLowerCase() === full.toLowerCase());
  const inTop1000 = idx >= 0;

  let repoName = full;
  let stars: number;
  let rank: number;
  let desc: string | null = null;
  let lang: string | null = null;
  let neighborNames: string[];

  if (inTop1000) {
    const e = ranked[idx];
    repoName = e.r;
    stars = e.s;
    rank = e.rank;
    desc = e.d ?? null;
    lang = e.l ?? null;
    neighborNames = [
      ...ranked.slice(idx + 1, idx + 6).map((p) => p.r).reverse(), // just behind us
      ...ranked.slice(Math.max(0, idx - 15), idx).map((p) => p.r).reverse(), // ahead, nearest first
    ];
  } else {
    const lite = await repoLite(owner, name);
    repoName = lite.nameWithOwner;
    stars = lite.stargazerCount;
    desc = lite.description;
    lang = lite.primaryLanguage?.name ?? null;
    rank = await worldwideRank(stars);
    neighborNames = await searchNeighbors(repoName, stars);
  }

  // one aliased call: own velocity + every neighbor's
  const vel = await neighborsVelocity([repoName, ...neighborNames]);
  const self = vel.find((v) => v.r.toLowerCase() === repoName.toLowerCase());
  const neighbors = vel.filter((v) => v.r.toLowerCase() !== repoName.toLowerCase());
  const v7d = self?.v ?? 0;
  if (self) {
    repoName = self.r;
    stars = self.s;
  }

  const milestoneRanks = nextMilestones(rank, 4).filter((m) => m <= ranked.length);
  const milestones = milestoneRanks.map((m) => ({
    rank: m,
    threshold: ranked[m - 1].s,
    drift: null,
  }));

  const apex = { r: ranked[0].r, s: ranked[0].s };
  const layers = buildRouteLayers(stars, milestones, apex, repoName);

  const inputs: ChartInputs = {
    repo: repoName,
    stars,
    rank,
    v7d,
    neighbors,
    milestones,
    apex,
    routeDots: layers.dots,
    routeLandmarks: layers.landmarks,
    routeAll: layers.all,
    nowMs: Date.now(),
  };

  return {
    inputs,
    desc,
    lang,
    neighbors,
    inTop1000,
    generatedAt: new Date().toISOString(),
  };
}
