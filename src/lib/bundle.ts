// Assembles every build-time series into one serializable bundle that the
// client dashboard receives as props. Runs on the server only (fs).
import {
  loadTimestamps, loadHistory, loadMeta, loadMilestones,
} from "./history";
import {
  hourlyBuckets, dailyCounts, movingAverage, madrugadaFloor,
  cumulativeSeries, heatmapMatrix, velocity7d, recentTimestamps,
  rankSeries, thresholdSeries,
} from "./series";
import { driftPerDay } from "./projections";
import type {
  RepoMetaFile, Snapshot, HourPoint, DayPoint, CumPoint, RankPoint,
  FloorPoint, Neighbor, Apex,
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

  return {
    meta,
    generatedAt: new Date(nowMs).toISOString(),
    totalStars: timestamps.length,
    netStars: latest?.stars ?? timestamps.length,
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
  };
}
