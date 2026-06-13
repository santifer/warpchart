// Fresh "current state" snapshot from Vercel Blob. A frequent collector
// (collector/live.mjs, every ~10 min, NO git commit and NO Vercel build)
// writes each tracked repo's live stars/rank/neighbors/milestones here, so
// paid tenant pages (and the house) paint near-real-time instead of the 2h
// committed snapshot. The heavy timestamp curve stays on the committed
// cadence; only the cheap "where am I right now" layer rides the Blob.
//
// The store is PUBLIC, so the read is a plain fetch with no token, cached at
// the edge for 60s. Any miss (no blob yet, store down, malformed) returns
// null and the caller falls back to the committed data: nothing breaks.
import type { Snapshot } from "./types";

// The public base URL of the warpchart-data Blob store. Overridable via env,
// with the store's own base as the default (it is public, not a secret).
const BASE =
  process.env.BLOB_PUBLIC_BASE ||
  "https://77crkqzqn9mvn2kj.public.blob.vercel-storage.com";

function blobKey(repo: string): string {
  return repo.toLowerCase().replace("/", "--");
}

export async function fetchLiveSnapshot(repo: string): Promise<Snapshot | null> {
  try {
    const res = await fetch(`${BASE}/live/${blobKey(repo)}.json`, {
      // edge-cached 60s, shared by every visitor; one origin read per minute
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<Snapshot>;
    if (
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
  } catch {
    return null;
  }
}
