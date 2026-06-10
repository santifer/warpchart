import { OWNER, NAME } from "@/lib/config";
import { currentStars, worldwideRank } from "@/lib/github";

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
    return Response.json(
      { error: (err as Error).message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
