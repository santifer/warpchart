// Data assembly for the instant explorer (/r/owner/name): a live snapshot of
// ANY GitHub repo's position on the route, with tiered cost:
//   - repo in the precomputed top 1000 -> 1 GraphQL call (velocities only)
//   - deep space -> ~5 calls (meta, rank, 2 searches, velocities)
// Pages are ISR-cached, so cost stays flat regardless of traffic.
import { loadRoute, loadMeta, lastSnapshot } from "./history";
import { repoLite, worldwideRank, searchNeighbors, neighborsVelocity, lowFuel } from "./github";
import { reqLog } from "./log";
import { nextMilestones } from "./milestones";
import { buildRouteLayers, forkRatioPercentile } from "./bundle";
import type { ChartInputs, Neighbor, RouteRepo } from "./types";

export interface ExplorerData {
  inputs: ChartInputs;
  desc: string | null;
  lang: string | null;
  neighbors: Neighbor[];
  inTop1000: boolean;
  forkRatio: number | null;
  forkPercentile: number | null;
  degraded: boolean; // velocity telemetry unavailable this refresh
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
  let forks: number | null = null;
  let neighborNames: string[];
  const log = reqLog("explorer", { repo: `${owner}/${name}` });
  const t0 = Date.now();

  if (inTop1000) {
    const e = ranked[idx];
    repoName = e.r;
    stars = e.s;
    rank = e.rank;
    desc = e.d ?? null;
    lang = e.l ?? null;
    forks = e.f ?? null;
    neighborNames = [
      // 10 behind (not 5): the fastest hunter is often several positions
      // back in dense ranking zones, and it is the chart's most urgent
      // object (15 ahead + 10 behind = the velocity call's 25-name cap)
      ...ranked.slice(idx + 1, idx + 11).map((p) => p.r).reverse(),
      ...ranked.slice(Math.max(0, idx - 15), idx).map((p) => p.r).reverse(), // ahead, nearest first
    ];
  } else {
    // LOW FUEL: a deep-space scan costs ~5 calls including the scarce
    // search budget; when every token is nearly dry, defer instead of
    // burning the reserve the hot pages depend on
    if (lowFuel()) {
      log.warn("deep-space.deferred", { reason: "low fuel" });
      throw new Error("high traffic: deep-space scans paused, retry in a few minutes");
    }
    const lite = await repoLite(owner, name);
    repoName = lite.nameWithOwner;
    stars = lite.stargazerCount;
    desc = lite.description;
    lang = lite.primaryLanguage?.name ?? null;
    forks = lite.forkCount;
    rank = await worldwideRank(stars);
    neighborNames = await searchNeighbors(repoName, stars);
  }

  // one aliased call: own velocity + every neighbor's. If JUST this fails
  // (flaky GitHub 5xx after retries), degrade for top-1000 repos instead of
  // erroring: route.json already gives us names and star counts.
  let neighbors: Neighbor[];
  let v7d = 0;
  let degraded = false;
  try {
    // low fuel: skip straight to the registry fallback instead of burning
    // 4-5 GraphQL calls on a page the route data can still draw
    if (lowFuel() && inTop1000) throw new Error("low fuel: serving registry data");
    const vel = await neighborsVelocity([repoName, ...neighborNames]);
    const self = vel.find((v) => v.r.toLowerCase() === repoName.toLowerCase());
    neighbors = vel.filter((v) => v.r.toLowerCase() !== repoName.toLowerCase());
    v7d = self?.v ?? 0;
    if (self) {
      repoName = self.r;
      stars = self.s;
    } else {
      log.warn("velocity.self-missing", { asked: repoName, got: vel.length });
    }
  } catch (err) {
    if (!inTop1000) throw err;
    degraded = true;
    log.error("velocity.degraded", err, { neighbors: neighborNames.length, inTop1000 });
    const byName = new Map(ranked.map((p) => [p.r, p]));
    neighbors = neighborNames
      .map((nm) => byName.get(nm))
      .filter((p): p is RouteRepo => Boolean(p))
      .map((p) => ({ r: p.r, s: p.s, v: 0, d: p.d ?? null, l: p.l ?? null }));
  }

  const milestoneRanks = nextMilestones(rank, 4).filter((m) => m <= ranked.length);
  const milestones = milestoneRanks.map((m) => ({
    rank: m,
    threshold: ranked[m - 1].s,
    drift: null,
    // drawn midway between rank N and rank N-1, a doorway between ships
    at: m >= 2 ? Math.round((ranked[m - 1].s + ranked[m - 2].s) / 2) : null,
  }));

  const apex = { r: ranked[0].r, s: ranked[0].s };
  const layers = buildRouteLayers(stars, milestones, apex, repoName);

  // The tenant is always a landmark of this instance's galaxy.
  const tenantMeta = loadMeta();
  const tenantSnap = lastSnapshot();
  const home =
    tenantMeta && tenantSnap && tenantMeta.repo.toLowerCase() !== repoName.toLowerCase()
      ? { r: tenantMeta.repo, s: tenantSnap.stars }
      : null;

  log.info("resolved", { inTop1000, rank, v7d: Math.round(v7d * 10) / 10, neighbors: neighbors.length, degraded, ms: Date.now() - t0 });

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
    home,
  };

  const forkRatio = forks !== null && stars > 0 ? forks / stars : null;
  const forkPercentile =
    forkRatio !== null ? forkRatioPercentile(forkRatio, route?.repos ?? []) : null;

  return {
    inputs,
    desc,
    lang,
    neighbors,
    inTop1000,
    forkRatio,
    forkPercentile,
    degraded,
    generatedAt: new Date().toISOString(),
  };
}
