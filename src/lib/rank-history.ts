// Reads the accumulated worldwide-rank distribution (top 10k) from the PRIVATE
// Blob and extracts ONE repo's world-rank trajectory. This is the rank-of-record
// moat: stars reconstruct any time, and world rank CAN be roughly reconstructed
// from public archives (GH Archive) but those reconstructions DRIFT; Warpchart
// records the live authoritative rank daily, so its dated trajectory is accurate
// from the day recording began. Powers the pricing page's "locked treasure"
// preview. Server-side only.
//
// The index is SHARDED (32 files, written by collector/route-history.mjs)
// because Next's data cache caps a cached item at 2MB and the full index is
// ~22MB. A repo query reads exactly one shard (~0.7MB), cached at most once per
// hour. The shard hash MUST stay identical to shardOf() in route-history.mjs.
import { get } from "@vercel/blob";
import { unstable_cache } from "next/cache";

const SHARDS = 32; // MUST match collector/route-history.mjs

interface Shard {
  dates: string[];
  series: Record<string, [string, number, number][]>; // repo -> [[isoDay, rank, stars]]
}

export interface RankHistoryPoint {
  t: number; // ms timestamp (midday UTC of the recorded day)
  rank: number;
  stars: number;
}

// deterministic fnv-1a, identical to shardOf() in collector/route-history.mjs
function shardOf(repo: string): number {
  let h = 2166136261;
  const s = repo.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % SHARDS;
}

async function readShard(i: number): Promise<Shard | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const res = await get(`route-history/shard-${i}.json`, { access: "private", token });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const parsed = JSON.parse(await new Response(res.stream).text()) as Shard;
    return parsed?.series ? parsed : null;
  } catch {
    return null;
  }
}

function cachedShard(i: number): Promise<Shard | null> {
  return unstable_cache(() => readShard(i), ["route-history-shard", String(i)], {
    revalidate: 3600,
  })();
}

// The COLD archive shard: every day evicted from the 90-day hot window, kept
// forever by collector/route-history.mjs (append-only, no `dates` field). Read
// uncached with useCache:false because it grows past the 2MB cached-read cap
// over time and is only read on the low-traffic paid trajectory surface. Absent
// (null) until the first day rolls out of the hot window (~day 91), so the merge
// below is a no-op until the moat is older than the window.
interface ArchiveShard {
  series: Record<string, [string, number, number][]>;
}

async function readArchiveShard(i: number): Promise<ArchiveShard | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const res = await get(`route-history/archive/shard-${i}.json`, {
      access: "private",
      token,
      useCache: false,
    });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const parsed = JSON.parse(await new Response(res.stream).text()) as ArchiveShard;
    return parsed?.series ? parsed : null;
  } catch {
    return null;
  }
}

// case-insensitive lookup of a repo's points in a shard's series map
function pullSeries(
  series: Record<string, [string, number, number][]> | undefined,
  repo: string,
): [string, number, number][] {
  if (!series) return [];
  const k =
    series[repo] !== undefined
      ? repo
      : Object.keys(series).find((x) => x.toLowerCase() === repo.toLowerCase());
  return k ? series[k] : [];
}

// A repo's world-rank trajectory from the accumulated distribution. Empty array
// when the repo has never been in the recorded top 10k (or nothing recorded
// yet): callers degrade gracefully.
// includeArchive merges the cold archive (the full >90-day record) and is the
// AUTHORIZED-only path: the archive read is uncached (useCache:false), so firing
// it on every public render (pricing, /r/, teasers) would be an unbounded private-
// Blob cost surface. Public surfaces only need the hot 90-day window (charted
// checks, the locked teaser); the full record is the paid/god deliverable, served
// from the WARPCHART_GOD_KEY-gated /api/v1/rank-history.
export async function repoRankTrajectory(
  repo: string,
  opts?: { includeArchive?: boolean },
): Promise<RankHistoryPoint[]> {
  const i = shardOf(repo);
  const [hot, archive] = await Promise.all([
    cachedShard(i).catch(() => null),
    opts?.includeArchive ? readArchiveShard(i).catch(() => null) : Promise.resolve(null),
  ]);
  // archive (older, evicted days) first, hot (recent 90d) second so it wins on
  // any overlapping day; dedup by ISO day. Delivers the FULL recorded trajectory
  // (>90 days) once the archive exists, while it stays the hot window until then.
  const byDay = new Map<string, [string, number, number]>();
  for (const p of pullSeries(archive?.series, repo)) byDay.set(p[0], p);
  for (const p of pullSeries(hot?.series, repo)) byDay.set(p[0], p);
  if (!byDay.size) return [];
  return [...byDay.values()]
    // Each daily point is stamped at noon UTC, which puts TODAY's point in the
    // FUTURE all morning: before 12:00 the curve ended at a time that had not
    // happened, and the live "now" point landed behind it, so the series went
    // backwards (caught 2026-07-28 08:26 UTC on react, next.js, mem0, odysseus
    // - and invisible after midday, which is why it survived yesterday's
    // checks). Clamp to now: a measurement cannot be dated later than the
    // moment it was read.
    .map(([d, rank, stars]) => ({
      t: Math.min(Date.parse(`${d}T12:00:00Z`), Date.now()),
      rank,
      stars,
    }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}
