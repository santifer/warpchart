// Pure computations over the ascending list of star timestamps (ISO strings)
// and the history snapshots. All run at build time on the server.
import type {
  Snapshot, HourPoint, DayPoint, CumPoint, RankPoint, FloorPoint,
} from "./types";

const HOUR = 3600_000;
const DAY = 86_400_000;

export function toMs(iso: string): number {
  return Date.parse(iso);
}

function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Hourly counts covering [now - hours, now], zero-filled.
export function hourlyBuckets(timestamps: string[], hours: number, nowMs: number): HourPoint[] {
  const start = Math.floor((nowMs - hours * HOUR) / HOUR) * HOUR;
  const buckets = new Map<number, number>();
  for (const iso of timestamps) {
    const ms = toMs(iso);
    if (ms < start) continue;
    const h = Math.floor(ms / HOUR) * HOUR;
    buckets.set(h, (buckets.get(h) ?? 0) + 1);
  }
  const out: HourPoint[] = [];
  for (let t = start; t <= nowMs; t += HOUR) {
    out.push({ t, c: buckets.get(t) ?? 0 });
  }
  return out;
}

// Daily counts for the last `days` UTC days (including today), zero-filled.
export function dailyCounts(timestamps: string[], days: number, nowMs: number): DayPoint[] {
  const counts = new Map<string, number>();
  const startMs = nowMs - (days - 1) * DAY;
  const startKey = utcDayKey(startMs);
  for (const iso of timestamps) {
    const key = iso.slice(0, 10);
    if (key < startKey) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = utcDayKey(nowMs - i * DAY);
    out.push({ d: key, c: counts.get(key) ?? 0 });
  }
  return out;
}

export function movingAverage(daily: DayPoint[], window = 7): (number | null)[] {
  return daily.map((_, i) => {
    if (i < window - 1) return null;
    const slice = daily.slice(i - window + 1, i + 1);
    return Math.round(slice.reduce((a, p) => a + p.c, 0) / window);
  });
}

// "Madrugada floor": for each UTC day, average stars/hour between 00:00-04:59.
// A rising floor distinguishes a ladder (escalera) from a sawtooth (sierra).
export function madrugadaFloor(timestamps: string[], days: number, nowMs: number): FloorPoint[] {
  const counts = new Map<string, number>();
  const startKey = utcDayKey(nowMs - (days - 1) * DAY);
  for (const iso of timestamps) {
    const key = iso.slice(0, 10);
    if (key < startKey) continue;
    const hour = parseInt(iso.slice(11, 13), 10);
    if (hour < 5) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: FloorPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = utcDayKey(nowMs - i * DAY);
    // Skip today if the madrugada window is not over yet.
    if (i === 0 && new Date(nowMs).getUTCHours() < 5) continue;
    out.push({ d: key, perHour: Math.round(((counts.get(key) ?? 0) / 5) * 10) / 10 });
  }
  return out;
}

// Downsampled cumulative series over the whole life of the repo.
export function cumulativeSeries(timestamps: string[], maxPoints = 700): CumPoint[] {
  const n = timestamps.length;
  if (!n) return [];
  const step = Math.max(1, Math.floor(n / maxPoints));
  const out: CumPoint[] = [];
  for (let i = 0; i < n; i += step) {
    out.push({ t: toMs(timestamps[i]), total: i + 1 });
  }
  if (out[out.length - 1].total !== n) {
    out.push({ t: toMs(timestamps[n - 1]), total: n });
  }
  return out;
}

// 7x24 matrix (UTC), rows Monday..Sunday.
export function heatmapMatrix(timestamps: string[]): number[][] {
  const m: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const iso of timestamps) {
    const d = new Date(toMs(iso));
    const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
    m[dow][d.getUTCHours()]++;
  }
  return m;
}

// Average stars/day over the trailing 7 days.
export function velocity7d(timestamps: string[], nowMs: number): number {
  const cutoff = nowMs - 7 * DAY;
  let count = 0;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    if (toMs(timestamps[i]) < cutoff) break;
    count++;
  }
  return Math.round((count / 7) * 10) / 10;
}

// Raw timestamps of the trailing `hours` (for client-side sliding windows).
export function recentTimestamps(timestamps: string[], hours: number, nowMs: number): string[] {
  const cutoff = nowMs - hours * HOUR;
  let i = timestamps.length;
  while (i > 0 && toMs(timestamps[i - 1]) >= cutoff) i--;
  return timestamps.slice(i);
}

export function rankSeries(history: Snapshot[]): RankPoint[] {
  return history
    .filter((s) => Number.isFinite(s.rank))
    .map((s) => ({ t: toMs(s.ts), rank: s.rank }));
}

// Per-milestone threshold series from history, for drift estimation.
export function thresholdSeries(history: Snapshot[], milestone: string): { t: number; y: number }[] {
  const out: { t: number; y: number }[] = [];
  for (const s of history) {
    const v = s.milestones?.[milestone];
    if (typeof v === "number") out.push({ t: toMs(s.ts), y: v });
  }
  return out;
}
