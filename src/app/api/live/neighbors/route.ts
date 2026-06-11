import { neighborsVelocity } from "@/lib/github";
import { lastSnapshot, lastNeighborsSnapshot } from "@/lib/history";

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=300, stale-while-revalidate=600";

export async function GET() {
  try {
    const snapshot = lastSnapshot();
    let names = (snapshot?.neighbors ?? []).map((n) => n.r);
    // the latest snapshot can lose its band to a GitHub outage; walk back
    // to the last surviving membership instead of freezing the chart
    if (!names.length) {
      names = (lastNeighborsSnapshot()?.neighbors ?? []).map((n) => n.r);
    }
    if (!names.length) {
      return Response.json(
        { neighbors: [], fetchedAt: new Date().toISOString() },
        { headers: { "Cache-Control": CACHE } }
      );
    }
    const neighbors = await neighborsVelocity(names);
    return Response.json(
      { neighbors, fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": CACHE } }
    );
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
