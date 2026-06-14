// Reads the accumulated worldwide-rank distribution index from the PRIVATE Blob
// (route-history/index.json, written daily by collector/route-history.mjs) and
// extracts ONE repo's world-rank trajectory. This is the un-backfillable moat:
// stars reconstruct any time, world rank only exists from the day we started
// recording the whole distribution. Powers the pricing page's "locked treasure"
// preview. Server-side only, cached: at most one Blob read per hour.
import { get } from "@vercel/blob";
import { unstable_cache } from "next/cache";

interface RankIndex {
  dates: string[];
  // repo -> [[isoDay, rank, stars], ...]
  series: Record<string, [string, number, number][]>;
}

export interface RankHistoryPoint {
  t: number; // ms timestamp (midday UTC of the recorded day)
  rank: number;
  stars: number;
}

async function readIndex(): Promise<RankIndex | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const res = await get("route-history/index.json", { access: "private", token });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const parsed = JSON.parse(await new Response(res.stream).text()) as RankIndex;
    return parsed?.series ? parsed : null;
  } catch {
    return null;
  }
}

const getCachedIndex = unstable_cache(readIndex, ["route-history-index"], { revalidate: 3600 });

// A repo's world-rank trajectory from the accumulated distribution. Empty array
// when the repo has never been in the recorded top 1000 (or nothing recorded
// yet): callers degrade gracefully.
export async function repoRankTrajectory(repo: string): Promise<RankHistoryPoint[]> {
  const idx = await getCachedIndex().catch(() => null);
  if (!idx?.series) return [];
  const lower = repo.toLowerCase();
  const key =
    idx.series[repo] !== undefined
      ? repo
      : Object.keys(idx.series).find((k) => k.toLowerCase() === lower);
  const pts = key ? idx.series[key] : null;
  if (!pts?.length) return [];
  return pts
    .map(([d, rank, stars]) => ({ t: Date.parse(`${d}T12:00:00Z`), rank, stars }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}
