// Fresh "current state" snapshot from the PRIVATE Vercel Blob store. A
// frequent collector (collector/live.mjs, every ~10 min, NO git commit and NO
// Vercel build) writes each tracked repo's live stars/rank/neighbors/
// milestones here, so paid tenant pages (and the house) paint near-real-time
// instead of the committed snapshot. The heavy timestamp curve stays on the
// committed cadence; only the cheap "where am I right now" layer rides Blob.
//
// The store is PRIVATE: the accumulated data is the moat, so nothing about it
// is publicly fetchable (a fork has no token and reads nothing). Reads happen
// SERVER-SIDE only, with the read-write token, wrapped in unstable_cache so a
// page's render reads at most once per 60s per repo. Any miss returns null and
// the caller falls back to the committed data: nothing breaks.
import { get } from "@vercel/blob";
import { unstable_cache } from "next/cache";
import type { Snapshot } from "./types";

function blobKey(repo: string): string {
  return repo.toLowerCase().replace("/", "--");
}

// Read + parse a private JSON blob server-side. Returns null on any miss.
async function readPrivateJson(pathname: string): Promise<unknown | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const res = await get(pathname, { access: "private", token });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return JSON.parse(await new Response(res.stream).text());
  } catch {
    return null;
  }
}

async function readLiveSnapshot(repo: string): Promise<Snapshot | null> {
  const j = (await readPrivateJson(`live/${blobKey(repo)}.json`)) as Partial<Snapshot> | null;
  if (
    !j ||
    typeof j.stars !== "number" ||
    typeof j.ts !== "string" ||
    typeof j.rank !== "number"
  ) {
    return null;
  }
  return {
    ts: j.ts,
    stars: j.stars,
    rank: j.rank,
    milestones: j.milestones ?? null,
    neighbors: j.neighbors ?? null,
    apex: j.apex ?? null,
  };
}

export async function fetchLiveSnapshot(repo: string): Promise<Snapshot | null> {
  const cached = unstable_cache(
    () => readLiveSnapshot(repo),
    ["live-snapshot", repo.toLowerCase()],
    { revalidate: 60 },
  );
  return cached();
}
