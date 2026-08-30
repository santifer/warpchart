import { OWNER, NAME } from "@/lib/config";
import { backwalkSince } from "@/lib/github";
import { lastTimestamp } from "@/lib/history";

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=60, stale-while-revalidate=300";

// Last good walk, per warm lambda. GitHub's GraphQL stargazers connection
// drops out for MINUTES at a time while simple queries keep answering
// (observed 2026-08-21), REST stargazers cannot reach the tail of a >40k-star
// repo (pagination capped), and the CDN's stale-while-revalidate only covers
// clients whose exact ?since= key was already cached. This in-memory copy is
// the last honest cushion: real timestamps, a few minutes old, served with
// partial:true so the client marks the window degraded instead of freezing.
let lastGood: {
  boundary: string;
  timestamps: string[];
  stars: number;
  fetchedAt: string;
} | null = null;

export async function GET(request: Request) {
  try {
    const lastBundled = lastTimestamp();
    if (!lastBundled) {
      return Response.json(
        { error: "no bundled timestamps; run bootstrap" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    // The walk-back boundary must be the CLIENT's newest bundled timestamp,
    // not the server's. The CDN can serve HTML whose 48h window ends BEFORE
    // the server's history boundary; walking only back to the server boundary
    // left every star in between missing from the client's merged window
    // (empty previous-hour bars, undercounted TODAY). The client sends its own
    // boundary as ?since=; clamped to 48h so a hostile value cannot force a
    // deep walk (maxPages already caps the cost anyway).
    let boundary = lastBundled;
    const since = new URL(request.url).searchParams.get("since");
    if (since) {
      const ms = Date.parse(since);
      const min = Date.now() - 48 * 3600_000;
      if (!Number.isNaN(ms)) {
        boundary = new Date(Math.max(ms, min)).toISOString().replace(/\.\d{3}Z$/, "Z");
      }
    }
    let walked = null;
    for (const delay of [0, 700, 1800]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        walked = await backwalkSince(OWNER, NAME, boundary, 10);
        break;
      } catch {
        // GraphQL turbulence; retry, then fall through to the cushion
      }
    }
    if (walked) {
      const { timestamps, stars, complete } = walked;
      if (complete) {
        lastGood = { boundary, timestamps, stars, fetchedAt: new Date().toISOString() };
      }
      return Response.json(
        {
          newTimestamps: timestamps,
          lastBundled,
          boundary,
          stars,
          partial: !complete,
          fetchedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": CACHE } }
      );
    }
    // Upstream down: serve the last good walk if it covers this boundary.
    // partial:true is deliberate: the client shows the degraded state and
    // keeps polling instead of freezing on the bundle clock.
    if (lastGood && lastGood.boundary <= boundary) {
      return Response.json(
        {
          newTimestamps: lastGood.timestamps.filter((t) => t > boundary),
          lastBundled,
          boundary,
          stars: lastGood.stars,
          partial: true,
          degraded: true,
          fetchedAt: lastGood.fetchedAt,
        },
        { headers: { "Cache-Control": "public, s-maxage=30" } }
      );
    }
    throw new Error("stargazers walk failed and no cached walk covers the boundary");
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
