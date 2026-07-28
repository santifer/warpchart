import { neighborsVelocity } from "@/lib/github";
import { lastSnapshot, lastNeighborsSnapshot, loadRoute } from "@/lib/history";
import { canonicalVelocity } from "@/lib/velocity";
import type { Neighbor } from "@/lib/types";

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
    const measured = await neighborsVelocity(names);
    // neighborsVelocity returns null where GitHub no longer lets us count a
    // foreign repo's recent stars, which since jun-2026 is EVERY neighbour.
    // This response OVERWRITES the server-rendered band the instant the page
    // flips from SYNCING to LIVE, so shipping those nulls made the whole local
    // band read 0/day right after the indicator cleared: the server had it
    // right and the live layer undid it. Fill from the registry's canonical
    // 7-day rate - the same source collect.mjs and the console already use.
    const canon = new Map(
      (loadRoute()?.repos ?? []).map((p) => [p.r.toLowerCase(), canonicalVelocity(p)] as const)
    );
    const neighbors: Neighbor[] = measured.map((n) => ({
      ...n,
      v: n.v ?? canon.get(n.r.toLowerCase()) ?? 0,
    }));
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
