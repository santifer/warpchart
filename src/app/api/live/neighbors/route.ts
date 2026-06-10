import { neighborsVelocity } from "@/lib/github";
import { lastSnapshot } from "@/lib/history";

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=300, stale-while-revalidate=600";

export async function GET() {
  try {
    const snapshot = lastSnapshot();
    const names = (snapshot?.neighbors ?? []).map((n) => n.r);
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
