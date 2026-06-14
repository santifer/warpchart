// Reads the accumulated worldwide-rank distribution (top 10k) from the PRIVATE
// Blob and extracts ONE repo's world-rank trajectory. This is the
// un-backfillable moat: stars reconstruct any time, world rank only exists from
// the day we started recording the whole distribution. Powers the pricing
// page's "locked treasure" preview. Server-side only.
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

// A repo's world-rank trajectory from the accumulated distribution. Empty array
// when the repo has never been in the recorded top 10k (or nothing recorded
// yet): callers degrade gracefully.
export async function repoRankTrajectory(repo: string): Promise<RankHistoryPoint[]> {
  const shard = await cachedShard(shardOf(repo)).catch(() => null);
  if (!shard?.series) return [];
  const key =
    shard.series[repo] !== undefined
      ? repo
      : Object.keys(shard.series).find((k) => k.toLowerCase() === repo.toLowerCase());
  const pts = key ? shard.series[key] : null;
  if (!pts?.length) return [];
  return pts
    .map(([d, rank, stars]) => ({ t: Date.parse(`${d}T12:00:00Z`), rank, stars }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}
