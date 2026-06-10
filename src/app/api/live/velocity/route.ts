import { OWNER, NAME } from "@/lib/config";
import { backwalkSince } from "@/lib/github";
import { lastTimestamp } from "@/lib/history";

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=60, stale-while-revalidate=300";

export async function GET() {
  try {
    const lastBundled = lastTimestamp();
    if (!lastBundled) {
      return Response.json(
        { error: "no bundled timestamps; run bootstrap" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    const { timestamps, stars, complete } = await backwalkSince(OWNER, NAME, lastBundled, 10);
    return Response.json(
      {
        newTimestamps: timestamps,
        lastBundled,
        stars,
        partial: !complete,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": CACHE } }
    );
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
