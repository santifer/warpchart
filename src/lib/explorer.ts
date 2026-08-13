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
import { canonicalVelocity } from "./velocity";
import { buildRouteLayers, forkRatioPercentile } from "./bundle";
import type { ChartInputs, Neighbor, RouteRepo } from "./types";

export interface Dossier extends DossierRaw {
  npmLast30: number | null;
  // daily download history (since launch) of the resolved npm package, so the
  // panel can draw the usage curve climbing over time, not just one number
  npmHistory: { day: string; d: number }[] | null;
  // daily git clones (the other acquisition channel for clone-and-run repos),
  // from the Traffic Vault. Only populated for the public house repo — every
  // other repo's traffic stays private.
  //
  // `u` is uniques PER DAY. IT MAY NOT BE SUMMED INTO A PEOPLE COUNT. Summing
  // counts a person once per day they appeared: the 72-day sum read 91,685
  // while GitHub's own deduplicated figure was 29,837 (2026-08-13), and the
  // panel was publishing that sum as "UNIQUE CLONERS". Sum `c` for clones,
  // never `u` for people.
  clonesHistory: { day: string; u: number; c: number }[] | null;
  // GitHub's deduplicated 14-day headcount, the only figure that may carry the
  // word "unique". null on vaults collected before this was stored.
  uniqueCloners14d: number | null;
  uniqueCloners14dAt: string | null;
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
  const candidates = [
    ...(rootPkg ? [rootPkg] : []),
    `@${owner.toLowerCase()}/${name.toLowerCase()}`,
  ];
  for (const cand of candidates) {
    // Fetch the point total and the daily history in PARALLEL, so a candidate
    // costs ~one 8s timeout instead of two back-to-back. No retry and no total
    // race-cap (an earlier cap was cutting a slow-but-valid npm mid-resolution
    // and blanking the whole npm channel): worst case is 2 candidates x ~8s =
    // ~16s, well under the /r/ maxDuration, and npm resolves as reliably as a
    // single lookup.
    const [dl, npmHistory] = await Promise.all([
      npmDownloads(cand),
      npmDownloadsRange(cand),
    ]);
    if (dl !== null) {
      return { npmPkg: cand, npmLast30: dl, npmHistory };
    }
  }
  return { npmPkg: null, npmLast30: null, npmHistory: null };
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
    //
    // THE SPLIT IS DELIBERATE, DO NOT "HARMONISE" IT. /api/traffic is key-gated
    // for every repo including this one (2026-08-12), but the clone SERIES
    // still renders here. That looks inconsistent and is not: the two surfaces
    // carry different things. This one is clones only; the vault endpoint also
    // carries views and the referrer breakdown, which is the channel mix and
    // the piece that actually helps a competitor. Santiago made this call on
    // 2026-08-12 with sponsor emails already out, weighing a complete public
    // report above the leak this reopens.
    //
    // Known and accepted: a cumulative total polled daily can be differenced
    // back into the daily series. Anything that draws a chart on a public page
    // ships that chart's data in the page payload anyway, so hiding it from the
    // API while rendering it here would be theatre, not protection.
    const repo = `${owner}/${name}`;
    const house = loadMeta()?.repo ?? "";
    let clonesHistory: { day: string; u: number; c: number }[] | null = null;
    let uniqueCloners14d: number | null = null;
    let uniqueCloners14dAt: string | null = null;
    if (house && repo.toLowerCase() === house.toLowerCase()) {
      const vault = await loadTrafficVault(repo);
      clonesHistory = vault?.days.map((dd) => ({ day: dd.d, u: dd.clonesU, c: dd.clones })) ?? null;
      uniqueCloners14d = vault?.uniq14?.cloners ?? null;
      uniqueCloners14dAt = vault?.uniq14?.at ?? null;
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
    // Each channel runs to its OWN latest day. They used to be truncated to the
    // earlier of the two, so that a day only appeared once every channel had
    // closed it - which meant the slowest channel aged the whole panel: npm
    // publishes its daily series 3-4 days late (stuck at 2026-07-24 while GitHub
    // traffic already had 07-26), so perfectly good clone data was thrown away
    // and the panel read as stale. The real problem was the CHART drawing a
    // missing npm day as zero; UsageChart now ends each line at its own last
    // real day instead, so nothing has to be discarded to keep it honest.
    return {
      ...raw,
      npmPkg,
      npmLast30,
      npmHistory: past(npmHistory),
      clonesHistory: past(clonesHistory),
      uniqueCloners14d,
      uniqueCloners14dAt,
    };
  } catch (err) {
    // A swallowed error here blanks BOTH dossier panels ("NO PUBLIC
    // DISTRIBUTION ARTIFACTS" + an empty maintenance pulse) with no trace
    // anywhere, which on 2026-08-07 made the failure unfalsifiable: every
    // component tested healthy in isolation while the page rendered empty.
    // The catch stays (one flaky GitHub or npm call must never be page-fatal)
    // but it no longer hides.
    reqLog("explorer").warn("dossier.fetch-failed", {
      repo: `${owner}/${name}`,
      err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return null;
  }
}

// A null from fetchDossier is a FAILURE, never a fact about the repo - and
// caching it pins that failure in front of every reader for the full 15-minute
// window. That is exactly what happened on 2026-08-07: one transient blip left
// career-ops showing "NO PUBLIC DISTRIBUTION ARTIFACTS" long after every
// underlying call had recovered, and only a redeploy cleared it. So a cached
// null is retried live, once. The cost lands only on the failing path; a
// healthy repo never pays it, and a genuinely broken one degrades exactly as
// before instead of staying broken for a quarter of an hour.
export const getCachedDossier = async (owner: string, name: string): Promise<Dossier | null> => {
  const cached = await cachedDossier(owner, name);
  if (cached) return cached;
  return fetchDossier(owner, name);
};

const cachedDossier = (owner: string, name: string) =>
  unstable_cache(
    () => fetchDossier(owner, name),
    // v8: invalidate entries cached by the short-lived npm total-cap that stored
    // a null npm (unstable_cache is not deploy-scoped, so the bad entry survived
    // the fix). Bumping the key forces a fresh resolve on next view.
    // v9: entries stored while both channels were truncated to the slowest one
    // hold clone days that were already discarded at write time - a redeploy
    // alone cannot recover them, only a new key can.
    // v10: the 30-day-total shape (uniqueCloners30, no clonesHistory) was live
    // for about an hour. Restoring the series without bumping this served that
    // shape from cache, so the panel came back with NO clone metric at all -
    // worse than either state. Third time this exact miss has cost a deploy:
    // CHANGE THE SHAPE, CHANGE THE KEY, IN THE SAME COMMIT.
    // v11: adds uniqueCloners14d. CHANGE THE SHAPE, CHANGE THE KEY, SAME COMMIT.
    ["dossier-v11", `${owner}/${name}`.toLowerCase()],
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
    // A null rate means GitHub would not let us count that repo's recent stars,
    // which is now the normal answer for anything we do not own. Substitute the
    // registry's canonical 7-day rate; only fall back to 0 for a repo we have
    // never tracked, where 0 is genuinely all we know.
    const canon = new Map(
      (loadRoute()?.repos ?? []).map((p) => [p.r.toLowerCase(), canonicalVelocity(p)] as const),
    );
    const settle = (n: { r: string; v: number | null }) =>
      n.v ?? canon.get(n.r.toLowerCase()) ?? 0;
    neighbors = vel
      .filter((v) => v.r.toLowerCase() !== repoName.toLowerCase())
      .map((n) => ({ ...n, v: settle(n) }));
    v7d = self ? settle(self) : 0;
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
    dossier = { ...raw, npmPkg, npmLast30, npmHistory, clonesHistory: null,
                uniqueCloners14d: null, uniqueCloners14dAt: null };
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
