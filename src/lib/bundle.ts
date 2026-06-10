// Assembles every build-time series into one serializable bundle that the
// client dashboard receives as props. Runs on the server only (fs).
import {
  loadTimestamps, loadHistory, loadMeta, loadMilestones, loadRoute,
} from "./history";
import {
  hourlyBuckets, dailyCounts, movingAverage, madrugadaFloor,
  cumulativeSeries, heatmapMatrix, velocity7d, recentTimestamps,
  rankSeries, thresholdSeries,
} from "./series";
import { driftPerDay } from "./projections";
import type {
  RepoMetaFile, Snapshot, HourPoint, DayPoint, CumPoint, RankPoint,
  FloorPoint, Neighbor, Apex, RouteRepo,
} from "./types";

export interface MilestoneInfo {
  rank: number;
  threshold: number;
  drift: number | null;
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
}

// Every dot on the route band is a real repo from the worldwide top 1000.
// Sampling halves per band away from the core: all repos in the top band,
// every 2nd in the next, every 4th, every 8th... (generalizes to any depth).
function buildRouteLayers(
  stars: number,
  milestones: MilestoneInfo[],
  apex: Apex | null,
  ownRepo: string | null
): { dots: RouteRepo[]; landmarks: RouteRepo[]; all: RouteRepo[] } {
  const route = loadRoute();
  if (!route || !apex || !route.repos.length) return { dots: [], landmarks: [], all: [] };
  const ranked: RouteRepo[] = route.repos.map((p, i) => ({ ...p, rank: i + 1 }));
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

export function buildBundle(): DashboardBundle {
  const nowMs = Date.now();
  const timestamps = loadTimestamps();
  const history = loadHistory();
  const meta = loadMeta();
  const latest: Snapshot | null = history.length ? history[history.length - 1] : null;

  // Latest known milestone thresholds; drift estimated from the full history.
  const msRecord = latest?.milestones ?? loadMilestones()?.milestones ?? {};
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

  const daily = dailyCounts(timestamps, 35, nowMs);
  const netStars = latest?.stars ?? timestamps.length;
  const { dots: routeDots, landmarks: routeLandmarks, all: routeAll } = buildRouteLayers(
    netStars, milestones, apex, meta?.repo ?? null
  );

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
    floor: madrugadaFloor(timestamps, 30, nowMs),
    cumulative: cumulativeSeries(timestamps),
    heatmap: heatmapMatrix(timestamps),
    v7d: velocity7d(timestamps, nowMs),
    recent48h: recentTimestamps(timestamps, 48, nowMs),
    rankHistory: rankSeries(history),
    neighbors,
    milestones,
    apex,
    routeDots,
    routeLandmarks,
    routeAll,
  };
}
