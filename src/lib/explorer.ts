import { unstable_cache } from "next/cache";
// Data assembly for the instant explorer (/r/owner/name): a live snapshot of
// ANY GitHub repo's position on the route, with tiered cost:
//   - repo in the precomputed top 1000 -> 1 GraphQL call (velocities only)
//   - deep space -> ~5 calls (meta, rank, 2 searches, velocities)
// Pages are ISR-cached, so cost stays flat regardless of traffic.
import { loadRoute, loadMeta, lastSnapshot } from "./history";
import {
  repoLite,
  worldwideRank,
  searchNeighbors,
  neighborsVelocity,
  lowFuel,
  repoDossier,
  npmDownloads,
  npmDownloadsRange,
  type DossierRaw,
} from "./github";
import { loadTrafficVault } from "./traffic";
import { reqLog } from "./log";
import { nextMilestones } from "./milestones";
import { buildRouteLayers, forkRatioPercentile } from "./bundle";
import type { ChartInputs, Neighbor, RouteRepo } from "./types";

export interface Dossier extends DossierRaw {
  npmLast30: number | null;
  // daily download history (since launch) of the resolved npm package, so the
  // panel can draw the usage curve climbing over time, not just one number
  npmHistory: { day: string; d: number }[] | null;
  // daily git clones (the other acquisition channel for clone-and-run repos),
  // from the Traffic Vault. Only populated for the public house repo — every
  // other repo's traffic stays private. u = unique cloners, c = raw count.
  clonesHistory: { day: string; u: number; c: number }[] | null;
}

// Resolve a repo's real npm usage. Tries the repo's own PUBLIC package name
// first, then the conventional scoped name @owner/name — repos frequently ship
// an installer published under a scope while the root app's package.json stays
// private (e.g. santifer/career-ops keeps the app private but publishes the
// `npx @santifer/career-ops` installer, ~4k downloads/month, which the bare
// package.json lookup missed). First candidate with real download data wins.
async function resolveNpmUsage(
  owner: string,
  name: string,
  rootPkg: string | null,
): Promise<{ npmPkg: string | null; npmLast30: number | null; npmHistory: { day: string; d: number }[] | null }> {
  const NONE: { npmPkg: string | null; npmLast30: number | null; npmHistory: { day: string; d: number }[] | null } = {
    npmPkg: null,
    npmLast30: null,
    npmHistory: null,
  };
  const candidates = [
    ...(rootPkg ? [rootPkg] : []),
    `@${owner.toLowerCase()}/${name.toLowerCase()}`,
  ];
  const work = (async () => {
    for (const cand of candidates) {
      const dl = await npmDownloads(cand);
      if (dl !== null) {
        const npmHistory = await npmDownloadsRange(cand);
        return { npmPkg: cand, npmLast30: dl, npmHistory };
      }
    }
    return NONE;
  })();
  // Hard cap TOTAL npm spend so a slow registry can never push the /r/ render
  // past its maxDuration: npm is best-effort (the panel falls back to clones and
  // stars) and a transient miss simply re-resolves on the next 15-min
  // revalidation. Bounding the whole resolution (not per-call) is what keeps a
  // multi-candidate, no-package repo from stacking several 8s timeouts.
  const cap = new Promise<typeof NONE>((resolve) => setTimeout(() => resolve(NONE), 8000));
  return Promise.race([work, cap]);
}

// standalone cached dossier for routes that don't run the full explorer
// assembly (the house and hosted-tenant consoles, AND the /r/ explorer panels)
export async function fetchDossier(owner: string, name: string): Promise<Dossier | null> {
  try {
    const raw = await repoDossier(owner, name);
    const { npmPkg, npmLast30, npmHistory } = await resolveNpmUsage(owner, name, raw.npmPkg);
    // git clones are the owner's PRIVATE traffic — surface them as a second
    // acquisition channel ONLY for the public house repo (its vault is the
    // opt-in demo). Unique cloners/day = the real-people proxy (raw count
    // includes CI/mirrors).
    const repo = `${owner}/${name}`;
    const house = loadMeta()?.repo ?? "";
    let clonesHistory: { day: string; u: number; c: number }[] | null = null;
    if (house && repo.toLowerCase() === house.toLowerCase()) {
      const vault = await loadTrafficVault(repo);
      clonesHistory = vault?.days.map((dd) => ({ day: dd.d, u: dd.clonesU, c: dd.clones })) ?? null;
    }
    // only surface COMPLETE days.
    // (1) the current UTC day is still accumulating -> drop it, so a partial
    //     "today" bucket never renders as a false dip.
    // (2) when BOTH channels exist, the trailing edge must be the latest day
    //     they SHARE: npm finalises ~1 day faster than GitHub Traffic, so a day
    //     with npm but no clones yet would draw clones as a false 0. Trim both
    //     to min(last npm day, last clones day). Earlier single-channel days
    //     (a channel that had not launched) are kept -- that absence is real,
    //     not a lag, and it is the intended channel lift-off.
    // The boundary recomputes on every 15-min cache revalidation, so a day
    // appears once EVERY channel has closed it.
    const todayUTC = new Date().toISOString().slice(0, 10);
    const past = <T extends { day: string }>(xs: T[] | null) =>
      xs ? xs.filter((x) => x.day < todayUTC) : xs;
    let np = past(npmHistory);
    let cl = past(clonesHistory);
    if (np && np.length && cl && cl.length) {
      const maxDay = (xs: { day: string }[]) => xs.reduce((m, x) => (x.day > m ? x.day : m), xs[0].day);
      const bound = [maxDay(np), maxDay(cl)].sort()[0]; // the earlier of the two latest days
      np = np.filter((x) => x.day <= bound);
      cl = cl.filter((x) => x.day <= bound);
    }
    return { ...raw, npmPkg, npmLast30, npmHistory: np, clonesHistory: cl };
  } catch {
    return null;
  }
}

export const getCachedDossier = (owner: string, name: string) =>
  unstable_cache(
    () => fetchDossier(owner, name),
    ["dossier-v7", `${owner}/${name}`.toLowerCase()],
    { revalidate: 900 },
  )();

export interface ExplorerData {
  inputs: ChartInputs;
  desc: string | null;
  lang: string | null;
  neighbors: Neighbor[];
  inTop1000: boolean;
  forkRatio: number | null;
  forkPercentile: number | null;
  // public maintenance pulse + real usage; null when the extra call failed
  // (the page renders fine without it)
  dossier: Dossier | null;
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

  // Canonical velocity: prefer the stable 7-day route rate (v7) over the noisy
  // last-30-stars estimate, so the /r/ header, prose and on-chart ETAs carry the
  // SAME number as the OG card and the API (bundle.ts does exactly this). Only a
  // deep-space repo with no route entry keeps the live estimate, as the honest
  // fallback.
  const routeV7 = new Map<string, number | null>(
    ranked.map((p) => [p.r.toLowerCase(), p.v7 ?? p.v ?? null]),
  );
  const focalV7 = routeV7.get(repoName.toLowerCase());
  if (focalV7 != null) v7d = focalV7;
  neighbors = neighbors.map((n) => {
    const rv = routeV7.get(n.r.toLowerCase());
    return rv != null ? { ...n, v: rv } : n;
  });

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

  // the dossier (maintenance pulse + real usage) is best-effort: one extra
  // GraphQL call plus an unauthenticated npm lookup, never page-fatal
  let dossier: Dossier | null = null;
  try {
    const [o, n] = repoName.split("/");
    const raw = await repoDossier(o, n);
    const { npmPkg, npmLast30, npmHistory } = await resolveNpmUsage(o, n, raw.npmPkg);
    // clones (private traffic) are surfaced only via the cached dossier path
    // (getCachedDossier -> fetchDossier), which the panels actually render
    dossier = { ...raw, npmPkg, npmLast30, npmHistory, clonesHistory: null };
  } catch (err) {
    log.warn("dossier.failed", { err: err instanceof Error ? err.message.slice(0, 120) : String(err) });
  }

  return {
    inputs,
    desc,
    lang,
    neighbors,
    inTop1000,
    forkRatio,
    forkPercentile,
    dossier,
    degraded,
    generatedAt: new Date().toISOString(),
  };
}

// A degraded result (velocity telemetry unavailable) must NOT enter the
// durable cache: throwing skips unstable_cache storage so the next visitor
// gets a fresh attempt instead of 15 poisoned minutes. The thrown error
// carries the data so THIS visitor still sees the degraded-but-usable page.
class DegradedResult extends Error {
  constructor(public data: NonNullable<ExplorerData>) {
    super("__degraded__");
  }
}

const getCachedExplorerData = unstable_cache(
  async (owner: string, name: string) => {
    const data = await getExplorerData(owner, name);
    if (data?.degraded) throw new DegradedResult(data);
    return data;
  },
  ["explorer-data"],
  { revalidate: 900 },
);

// Short per-instance memory of degraded results: during an upstream storm every
// visitor would otherwise pay the full retry budget for the same degraded
// outcome (Fluid reuses instances, so most hits land here).
const degradedCache = new Map<string, { data: NonNullable<ExplorerData>; until: number }>();

// Resilient accessor shared by the explorer page (/r/owner/name) and the
// personalized pricing page (/pricing?repo=owner/name) so both read the SAME
// cached snapshot: identical numbers, and one GitHub spend per repo per 15 min
// (a pricing visit that follows a repo visit is free). Returns null for a repo
// that does not exist; rethrows transient upstream errors so the caller can
// 500-and-retry rather than cache a 404.
export async function loadExplorerData(
  owner: string,
  name: string,
): Promise<NonNullable<ExplorerData> | null> {
  const key = `${owner}/${name}`.toLowerCase();
  const recent = degradedCache.get(key);
  if (recent && recent.until > Date.now()) return recent.data;
  try {
    return await getCachedExplorerData(owner, name);
  } catch (err) {
    if (err instanceof DegradedResult) {
      degradedCache.set(key, { data: err.data, until: Date.now() + 180_000 });
      return err.data;
    }
    // a real "repository not found" -> null (caller decides 404 vs graceful);
    // transient GitHub errors rethrow so the route never caches a false 404
    if (err instanceof Error && /not[ _]?found|could not resolve/i.test(err.message)) {
      return null;
    }
    console.error(`[explorer] ${owner}/${name} failed:`, err);
    throw err;
  }
}
