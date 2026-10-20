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
import { reconstructDays, repoDailyRanks, repoReconstructedRanks } from "../../collector/velocity-rank-core.mjs";
import { allNamesOf } from "./aliases";

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
  // true = before the live record began: rebuilt from GitHub's star history
  // (current stargazers only, UTC days), see collector/velocity-rank-backfill.mjs
  reconstructed?: boolean;
  why?: "unrecorded" | "step" | "unborn";
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
// rebuilt once a day, so an hour of staleness is at most one day behind.
// Only what was found is cached (a miss throws past unstable_cache), so a
// transient Blob error is one 503, not an hour of "unavailable"
const found = <T,>(what: string) => (v: T | null): T => {
  if (v == null) throw new Error(`${what} missing`);
  return v;
};
const readMetaCached = unstable_cache(
  async () => found<Meta>("velocity-rank/meta.json")(await readBlob<Meta>("velocity-rank/meta.json")),
  ["velocity-rank-meta-v2"],
  { revalidate: 3600 },
);
const readMeta = () => readMetaCached().catch(() => null);
const readMonth = (m: string) =>
  unstable_cache(
    async () => found<{ days: VelocityRankDay[] }>(m)(await readBlob<{ days: VelocityRankDay[] }>(`velocity-rank/${m}.json`)),
    ["velocity-rank-month-v2", m],
    { revalidate: 3600 },
  )().catch(() => null);

interface Reconstructed {
  from: string;
  to: string;
  days: string[];
  repos: Record<string, { end: number; g: number[] }>;
}
// written once by hand (velocity-rank-backfill.mjs) and never again: a day's
// cache is plenty. ONLY a found file is cached: a miss throws past the cache,
// or a request made before the upload would hide the reconstruction for 24 h
// (it did, in the first local run).
const readReconstructedCached = unstable_cache(
  async () => {
    const r = await readBlob<Reconstructed>("velocity-rank/reconstructed.json");
    if (!r?.days?.length) throw new Error("velocity-rank/reconstructed.json missing");
    return r;
  },
  ["velocity-rank-reconstructed-v2"],
  { revalidate: 86_400 },
);
// re-uploading the file needs a NEW key above, or the old one is served a day
const readReconstructed = () => readReconstructedCached().catch(() => null);
// 74 sorts of 2,000 repos per request is cheap but pointless: once per file
let recMemo: { key: string; days: ReturnType<typeof reconstructDays> } | null = null;
const reconstructedDays = (rec: Reconstructed & { builtAt?: string }) => {
  const key = rec.builtAt ?? rec.to;
  if (recMemo?.key !== key) recMemo = { key, days: reconstructDays(rec.days, rec.repos) };
  return recMemo.days;
};

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
  const recorded = (repoDailyRanks(table.days, series) as Omit<VelocityRankPoint, "hours">[]).map((p) => ({
    ...p,
    hours: hours.get(p.day) ?? null,
  }));
  // the days before the live record, rebuilt; only those strictly before the
  // first recorded day, so the two never overlap. A missing file just means
  // no reconstructed part, never an error.
  const rec = await readReconstructed();
  const firstRecorded = table.days[0]?.day ?? "9999";
  const rebuilt: VelocityRankPoint[] = rec?.days?.length
    ? (repoReconstructedRanks(reconstructedDays(rec), rec.repos, allNamesOf(repo)) as Omit<VelocityRankPoint, "hours">[])
        .filter((p) => p.day < firstRecorded && p.why !== "unborn")
        .map((p) => ({ ...p, hours: null }))
    : [];
  const points: VelocityRankPoint[] = [...rebuilt, ...recorded];
  // the record starts on the repo's first measured day, not on the moat's
  const first = points.findIndex((p) => p.rank != null);
  return { top: table.meta.top, builtAt: table.meta.builtAt, points: first < 0 ? [] : points.slice(first) };
}
