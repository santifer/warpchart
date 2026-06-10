import { OWNER, NAME } from "@/lib/config";
import { currentStars, worldwideRank } from "@/lib/github";
import { lastSnapshot } from "@/lib/history";

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=60, stale-while-revalidate=300";

export async function GET() {
  try {
    const stars = await currentStars(OWNER, NAME);
    const rank = await worldwideRank(stars);
    return Response.json(
      { stars, rank, fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": CACHE } }
    );
  } catch (err) {
    // GitHub turbulence: fall back to the last hourly snapshot so the live
    // counter never freezes on the client (it keeps polling and recovers).
    const snap = lastSnapshot();
    if (snap) {
      return Response.json(
        { stars: snap.stars, rank: snap.rank, fetchedAt: snap.ts, stale: true },
        { headers: { "Cache-Control": "public, s-maxage=30" } }
      );
    }
    return Response.json(
      { error: (err as Error).message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
