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
import { mergeReconstructed, reconstructDays, repoDailyRanks, repoReconstructedRanks } from "../../collector/velocity-rank-core.mjs";
import { allNamesOf } from "./aliases";
import { monthlyTierBands, type LadderBand } from "./ladder-bands";

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
  // true = rebuilt from GitHub's star history (current stargazers only,
  // Pacific-time days), see collector/velocity-rank-backfill.mjs: the days
  // before the live record began, and the days a truncated sweep left out of it
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

async function readBlob<T>(key: string, fresh = false): Promise<T | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    // fresh: from origin, for a file rewritten in place (the CDN keeps the
    // old copy for weeks, and a bumped cache key alone would read it again)
    const res = await get(key, { access: "private", token, ...(fresh ? { useCache: false } : {}) });
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
  ["velocity-rank-reconstructed-v3"], // v3: the window runs to 30 Sep (gap fill)
  { revalidate: 86_400 },
);
// re-uploading the file needs a NEW key above, or the old one is served a day
const readReconstructed = () => readReconstructedCached().catch(() => null);
// holes opened after the main reconstruction (velocity-rank-backfill.mjs gap
// mode): a short window of its own, same shape, same rules. First: 2026-11-03,
// erased by a stale shard write (incident 2026-11-04). Only a found file is
// cached, so a miss never hides a later upload.
const readGapsCached = unstable_cache(
  async () => {
    const r = await readBlob<{ windows?: Reconstructed[] }>("velocity-rank/reconstructed-gaps.json", true);
    if (!r?.windows?.length) throw new Error("velocity-rank/reconstructed-gaps.json missing");
    return r.windows;
  },
  // re-uploading the gap file (a new window) needs a NEW key, or the old
  // copy is served for up to a day
  ["velocity-rank-reconstructed-gaps-v1"],
  { revalidate: 86_400 },
);
const readGaps = () => readGapsCached().catch(() => [] as Reconstructed[]);
// 74 sorts of 2,000 repos per request is cheap but pointless: once per file
const recMemo = new Map<string, ReturnType<typeof reconstructDays>>();
const reconstructedDays = (rec: Reconstructed & { builtAt?: string }) => {
  const key = `${rec.from}:${rec.to}:${rec.builtAt ?? ""}`;
  let days = recMemo.get(key);
  if (!days) {
    days = reconstructDays(rec.days, rec.repos);
    if (recMemo.size > 16) recMemo.clear();
    recMemo.set(key, days);
  }
  return days;
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
  // rebuilt days fill only the days the table lacks (before it, and the gaps
  // truncated sweeps left in it); a recorded day always wins
  // (mergeReconstructed). A missing file just means no reconstructed part,
  // never an error.
  const [main, gaps] = await Promise.all([readReconstructed(), readGaps()]);
  const files = [...(main?.days?.length ? [{ rec: main, gap: false }] : []), ...gaps.filter((g) => g?.days?.length).map((rec) => ({ rec, gap: true }))];
  const rebuilt: VelocityRankPoint[] = files.flatMap(({ rec, gap }) =>
    (repoReconstructedRanks(reconstructedDays(rec), rec.repos, allNamesOf(repo)) as Omit<VelocityRankPoint, "hours">[]).map((p) => ({
      ...p,
      hours: null,
      ...(gap ? { gap: true } : {}),
    })),
  );
  const points = mergeReconstructed(recorded, rebuilt) as VelocityRankPoint[];
  // the record starts on the repo's first measured day, not on the moat's
  const first = points.findIndex((p) => p.rank != null);
  return { top: table.meta.top, builtAt: table.meta.builtAt, points: first < 0 ? [] : points.slice(first) };
}

// The daily ladder's background zones (src/lib/ladder-bands.ts): per month,
// the stars a day needed to enter the top 10/50/100/250 by new stars. Monthly
// medians only, never which repo held which place, so they ride on the PUBLIC
// page (the per-day table stays behind the god key). Computed once an hour
// with `through` = that hour's UTC day, so the current month has its zone from
// its first day. Only a found result is cached (a miss throws past
// unstable_cache): a Blob blip is one render without zones, not an hour.
const ladderBandsCached = unstable_cache(
  async (): Promise<LadderBand[]> => {
    const table = await velocityRankTable();
    if (!table) throw new Error("velocity-rank table missing");
    const bands = monthlyTierBands(table.days, { top: table.meta.top, through: new Date().toISOString().slice(0, 10) });
    if (!bands.length) throw new Error("no ladder bands");
    return bands;
  },
  ["ladder-bands-v1"],
  { revalidate: 3600 },
);
// null = no zones this render (the ladder draws plain bars, the watchdog's
// presence.ladder-bands reports it). The console's render now waits on this
// Blob read, and the Blob client has no timeout of its own: past 3 s the page
// goes without zones rather than hanging up to maxDuration.
export const ladderBands = (): Promise<LadderBand[] | null> =>
  Promise.race([
    ladderBandsCached().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);
