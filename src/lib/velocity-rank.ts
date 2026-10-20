// Where a repo placed, day by day, among the worldwide top 1,000 by NEW stars
// that day. The day table (each day's top-1,000 gains) is built by
// collector/velocity-rank.mjs into the private Blob, one file per month; the
// repo's own gains come from its rank-history series (merged across every name
// it carried). The rank itself is computed by the SAME pure functions the
// collector uses (collector/velocity-rank-core.mjs), so the two cannot drift.
// Server-side only; served locked, through the god-key /api/v1/velocity-rank.
import { get } from "@vercel/blob";
import { unstable_cache } from "next/cache";
import { repoRankSeries } from "./rank-history";
import { repoDailyRanks } from "../../collector/velocity-rank-core.mjs";

export interface VelocityRankDay {
  day: string; // UTC day the stars came in (the capture of `day` -> the capture of the next day)
  to: string;
  n: number; // how many of the top 1,000 were ranked that day (a purge/restore step is left out)
  gains: number[]; // highest first
  hours: number | null; // length of the capture window, when both captures were stamped
}

export interface VelocityRankPoint {
  day: string;
  rank: number | null; // null = not measurable that day, never a bad day
  gain: number | null; // NET stars in that day's capture window (in minus out)
  n: number;
  hours: number | null;
  inTop?: boolean; // false = outside the top 1,000 that day: rank is where it WOULD have placed
  why?: "unrecorded" | "step";
}

interface Meta {
  top: number;
  months: string[];
  days: number;
  first: string | null;
  last: string | null;
  lastTo: string | null;
  builtAt: string;
}

async function readBlob<T>(key: string): Promise<T | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const res = await get(key, { access: "private", token });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return JSON.parse(await new Response(res.stream).text()) as T;
  } catch {
    return null;
  }
}

// one cache entry per file (each well under Next's 2 MB cap); the table is
// rebuilt once a day, so an hour of staleness is at most one day behind
const readMeta = unstable_cache(() => readBlob<Meta>("velocity-rank/meta.json"), ["velocity-rank-meta-v1"], {
  revalidate: 3600,
});
const readMonth = (m: string) =>
  unstable_cache(() => readBlob<{ days: VelocityRankDay[] }>(`velocity-rank/${m}.json`), ["velocity-rank-month-v1", m], {
    revalidate: 3600,
  })();

export async function velocityRankTable(): Promise<{ meta: Meta; days: VelocityRankDay[] } | null> {
  const meta = await readMeta();
  if (!meta?.months?.length) return null;
  const months = await Promise.all(meta.months.map((m) => readMonth(m)));
  // a month that failed to load would open a silent hole in the chart: say
  // nothing rather than a partial record
  if (months.some((m) => !m?.days)) return null;
  return { meta, days: months.flatMap((m) => m!.days) };
}

// null = the table is not available (not built yet or unreadable): the caller
// shows "unavailable", never an empty chart that reads as "never ranked"
export async function repoVelocityRank(repo: string): Promise<{
  top: number;
  builtAt: string;
  points: VelocityRankPoint[];
} | null> {
  const table = await velocityRankTable();
  if (!table) return null;
  const series = await repoRankSeries(repo, { includeArchive: true, fresh: true });
  const hours = new Map(table.days.map((d) => [d.day, d.hours ?? null]));
  const points = (repoDailyRanks(table.days, series) as Omit<VelocityRankPoint, "hours">[]).map((p) => ({
    ...p,
    hours: hours.get(p.day) ?? null,
  }));
  // the record starts on the repo's first measured day, not on the moat's
  const first = points.findIndex((p) => p.rank != null);
  return { top: table.meta.top, builtAt: table.meta.builtAt, points: first < 0 ? [] : points.slice(first) };
}
