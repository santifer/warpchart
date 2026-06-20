// Assembles every build-time series into one serializable bundle that the
// client dashboard receives as props. Runs on the server only (fs).
import {
  loadTimestamps, loadHistory, loadMeta, loadMilestones, loadRoute, loadForensics, loadAttribution,
} from "./history";
import {
  hourlyBuckets, dailyCounts, movingAverage, madrugadaFloor,
  cumulativeSeries, heatmapMatrix, velocity7d, recentTimestamps,
  rankSeries, thresholdSeries,
} from "./series";
import { driftPerDay } from "./projections";
import { detectEvents, captainsLog, surgeEvents } from "./events";
import { repoBadges, type RepoBadges } from "./badges";
import { canonicalVelocity } from "./velocity";
import type {
  RepoMetaFile, Snapshot, HourPoint, DayPoint, CumPoint, RankPoint,
  FloorPoint, Neighbor, Apex, RouteRepo, MissionEvent, Spike,
} from "./types";

const HOUR = 3600_000;
const DAY = 86_400_000;

export interface MilestoneInfo {
  rank: number;
  threshold: number;
  drift: number | null;
  // drawn position: midpoint between rank N and rank N-1 (see ChartInputs)
  at?: number | null;
}

export interface DashboardBundle {
  meta: RepoMetaFile | null;
  generatedAt: string;
  totalStars: number; // gross star events (cumulative timestamps)
  netStars: number; // net stargazer count from the latest snapshot
  rank: number | null;
  lastTimestamp: string | null;
  lastSnapshotAt: string | null;
  hourly: HourPoint[];
  daily: DayPoint[];
  ma7: (number | null)[];
  floor: FloorPoint[];
  cumulative: CumPoint[];
  heatmap: number[][];
  v7d: number;
  recent48h: string[];
  rankHistory: RankPoint[];
  neighbors: Neighbor[];
  milestones: MilestoneInfo[];
  apex: Apex | null;
  routeDots: RouteRepo[];
  routeLandmarks: RouteRepo[];
  routeAll: RouteRepo[]; // full top 1000, for the pannable local-system window
  hourlyAll: HourPoint[]; // hourly counts over the repo's whole life (replay)
  events: MissionEvent[];
  captain: string | null;
  spikes: Spike[];
  forkRatio: number | null; // forks / stars
  forkPercentile: number | null; // share of top 1000 repos with a LOWER ratio
  badges: RepoBadges; // earned classifications (class + designations)
}

// Percentile of a fork/star ratio against the top 1000 population.
export function forkRatioPercentile(
  ratio: number,
  population: { s: number; f?: number }[]
): number | null {
  const ratios = population
    .filter((p) => typeof p.f === "number" && p.s > 0)
    .map((p) => (p.f as number) / p.s);
  if (ratios.length < 100) return null;
  const below = ratios.filter((x) => x < ratio).length;
  return Math.round((below / ratios.length) * 100);
}

// Every dot on the route band is a real repo from the worldwide top 1000.
// Sampling halves per band away from the core: all repos in the top band,
// every 2nd in the next, every 4th, every 8th... (generalizes to any depth).
export function buildRouteLayers(
  stars: number,
  milestones: MilestoneInfo[],
  apex: Apex | null,
  ownRepo: string | null
): { dots: RouteRepo[]; landmarks: RouteRepo[]; all: RouteRepo[] } {
  const route = loadRoute();
  if (!route || !apex || !route.repos.length) return { dots: [], landmarks: [], all: [] };
  // Canonical velocity on every route dot: override v with the stable 7-day rate
  // (v7), the noisy ~1-day v only as fallback. The chart's doppler hue, dot
  // tails, drift positions, promoted-dot ETAs and scan-card readouts all read
  // dot.v, so this one override makes the explorer chart agree with /velocity,
  // the API and the headline figure instead of showing the 1-day diff.
  const ranked: RouteRepo[] = route.repos.map((p, i) => ({ ...p, rank: i + 1, v: canonicalVelocity(p) }));
  const thresholdsAsc = milestones
    .map((m) => m.threshold)
    .filter((t) => t > stars)
    .sort((a, b) => a - b);
  const bounds = [stars, ...thresholdsAsc, apex.s];

  const dots: RouteRepo[] = [];
  const landmarks: RouteRepo[] = [];
  const nSeg = bounds.length - 1;
  for (let i = 0; i < nSeg; i++) {
    const lo = bounds[i];
    const hi = bounds[i + 1];
    const seg = ranked.filter(
      (p) => p.s > lo && p.s < hi && p.r !== apex.r && p.r !== ownRepo
    );
    const fromTop = nSeg - 1 - i;
    const step = 2 ** fromTop;
    dots.push(...seg.filter((_, idx) => idx % step === 0));
    if (fromTop === 0) {
      // The widest band in log space gets a few famous anchors.
      for (const idx of [1, 5, 19]) if (seg[idx]) landmarks.push(seg[idx]);
    } else {
      const mid = seg[Math.floor(seg.length / 2)];
      if (mid) landmarks.push(mid);
    }
  }
  return { dots, landmarks, all: ranked };
}

// With no source the bundle is the house repo's; hosted tenants feed their
// own timestamps/history (collected by the same pipeline) plus whatever
// meta the caller already holds. Tenant snapshots may lack milestones,
// neighbors or apex: every consumer below already tolerates absence.
export function buildBundle(
  src?: {
    timestamps: string[];
    history: Snapshot[];
    meta: RepoMetaFile | null;
  },
  // optional fresh "current state" from Vercel Blob (collector/live.mjs):
  // stars/rank/neighbors/milestones collected every ~10 min without a build.
  // When strictly newer than the committed tail it becomes the latest
  // snapshot, so the headline, rank, neighbors and gates all paint fresh
  // while the heavy timestamp curve stays on the committed cadence.
  live?: Snapshot | null,
): DashboardBundle {
  const nowMs = Date.now();
  const timestamps = src ? src.timestamps : loadTimestamps();
  let history = src ? src.history : loadHistory();
  if (
    live &&
    (!history.length ||
      Date.parse(live.ts) > Date.parse(history[history.length - 1].ts))
  ) {
    history = [...history, live];
  }
  const meta = src ? src.meta : loadMeta();
  const latest: Snapshot | null = history.length ? history[history.length - 1] : null;

  // Latest known milestone thresholds; drift estimated from the full
  // history. Tenants never fall back to the HOUSE milestone file: their
  // gates belong to their own rank neighborhood.
  const msRecord = latest?.milestones ?? (src ? {} : loadMilestones()?.milestones) ?? {};
  const milestones: MilestoneInfo[] = Object.entries(msRecord)
    .map(([rank, threshold]) => ({
      rank: Number(rank),
      threshold,
      drift: driftPerDay(thresholdSeries(history, rank)),
    }))
    .sort((a, b) => b.rank - a.rank);

  // Latest snapshot that knows the neighbors / the apex.
  let neighbors: Neighbor[] = [];
  let apex: Apex | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (!neighbors.length && history[i].neighbors?.length) neighbors = history[i].neighbors!;
    if (!apex && history[i].apex) apex = history[i].apex!;
    if (neighbors.length && apex) break;
  }
  // the worldwide #1 is global truth: tenant histories without their own
  // apex snapshot borrow it from the registry so the route band still draws
  if (!apex) {
    const top = loadRoute()?.repos[0];
    if (top) apex = { r: top.r, s: top.s };
  }

  // Stars-per-day over the WHOLE life of the repo, so the daily ladder pans
  // back to the very first star (not just a trailing 2-month window). Capped at
  // 400 days. dailyAll below reuses this exact series.
  const firstMs = timestamps.length ? Date.parse(timestamps[0]) : nowMs;
  const lifeDays = Math.min(Math.ceil((nowMs - firstMs) / DAY) + 1, 400);
  const daily = dailyCounts(timestamps, lifeDays, nowMs);
  const netStars = latest?.stars ?? timestamps.length;
  const { dots: routeDots, landmarks: routeLandmarks, all: routeAll } = buildRouteLayers(
    netStars, milestones, apex, meta?.repo ?? null
  );
  // gates draw midway between rank N and rank N-1: a doorway between ships,
  // never on top of the rank-N repo itself
  for (const m of milestones) {
    const above = routeAll.find((p) => p.rank === m.rank - 1);
    m.at = above ? Math.round((m.threshold + above.s) / 2) : null;
  }

  // Whole-life hourly series for replay + event detection; dailyAll is the same
  // full-life daily series the ladder uses (firstMs/lifeDays computed above).
  const lifeHours = Math.min(Math.ceil((nowMs - firstMs) / HOUR) + 1, 24 * 400);
  const hourlyAll = hourlyBuckets(timestamps, lifeHours, nowMs);
  const dailyAll = daily;
  const spikes = loadForensics()?.spikes ?? [];
  // Hourly surge attribution is house-only (attribution.json never exists for a
  // tenant's data), so it merges only into the house Mission Log.
  const surges = src ? [] : (loadAttribution()?.surges ?? []);
  const events = detectEvents(history, dailyAll, spikes, surgeEvents(surges));
  const captain = captainsLog(dailyAll, latest?.rank ?? null);

  // engagement: fork/star ratio vs the top 1000 population
  const route = loadRoute();
  // ONE canonical velocity (compare.ts projectCrossing reads it everywhere):
  // prefer the stable 7-day route rate (v7) over the noisy ~1-day v, so the
  // scan-card ETAs match the race and the overtake scan. Enrich the focal
  // velocity and every neighbor from the same source.
  const routeV7 = new Map(
    (route?.repos ?? []).map((p) => [p.r.toLowerCase(), canonicalVelocity(p)] as const),
  );
  neighbors = neighbors.map((n) => {
    const rv = routeV7.get(n.r.toLowerCase());
    return rv != null ? { ...n, v: rv } : n;
  });
  const focalV7 = meta?.repo ? routeV7.get(meta.repo.toLowerCase()) ?? null : null;
  let forkRatio: number | null = null;
  let forkPercentile: number | null = null;
  if (meta && meta.forks > 0 && netStars > 0) {
    forkRatio = meta.forks / netStars;
    forkPercentile = forkRatioPercentile(forkRatio, route?.repos ?? []);
  }

  return {
    meta,
    generatedAt: new Date(nowMs).toISOString(),
    totalStars: timestamps.length,
    netStars,
    rank: latest?.rank ?? null,
    lastTimestamp: timestamps.length ? timestamps[timestamps.length - 1] : null,
    lastSnapshotAt: latest?.ts ?? null,
    hourly: hourlyBuckets(timestamps, 8 * 24, nowMs),
    daily,
    ma7: movingAverage(daily, 7),
    floor: madrugadaFloor(timestamps, lifeDays, nowMs),
    cumulative: cumulativeSeries(timestamps),
    heatmap: heatmapMatrix(timestamps),
    v7d: focalV7 ?? velocity7d(timestamps, nowMs),
    recent48h: recentTimestamps(timestamps, 48, nowMs),
    rankHistory: rankSeries(history),
    neighbors,
    milestones,
    apex,
    routeDots,
    routeLandmarks,
    routeAll,
    hourlyAll,
    events,
    captain,
    spikes,
    forkRatio,
    forkPercentile,
    badges: repoBadges(meta?.repo ?? ""),
  };
}
