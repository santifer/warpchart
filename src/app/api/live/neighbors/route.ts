import { starsBatch } from "@/lib/github";
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
    // This response REPLACES the server-rendered neighbour band the instant the
    // page flips from SYNCING to LIVE, so whatever it lacks, the visitor loses.
    // It used to call neighborsVelocity, which cannot work any more: GitHub
    // closed stargazer listing for repos we do not own, so the query returns
    // empty edges at best and FORBIDDEN (killing every chunk, 502) with the
    // app's installation token at worst. Either way the band went to 0/day the
    // moment the indicator cleared - the server had it right and the live layer
    // undid it.
    //
    // Live star counts still work (stargazerCount is unrestricted), and the
    // velocity we trust is the registry's canonical 7-day rate, measured from
    // our own daily snapshots. So: one cheap batched call for the counts, the
    // registry for everything else, and no dependency on an endpoint GitHub
    // took away.
    const route = loadRoute()?.repos ?? [];
    const reg = new Map(route.map((p) => [p.r.toLowerCase(), p] as const));
    const prev = new Map(
      (snapshot?.neighbors ?? lastNeighborsSnapshot()?.neighbors ?? []).map(
        (n) => [n.r.toLowerCase(), n] as const
      )
    );
    const live = await starsBatch(names).catch(() => ({}) as Record<string, number>);
    const neighbors: Neighbor[] = names.map((r) => {
      const k = r.toLowerCase();
      const p = reg.get(k);
      const before = prev.get(k);
      return {
        r: p?.r ?? before?.r ?? r,
        // stars only ever climb: an older read must not drag a ship backwards
        s: Math.max(live[k] ?? 0, p?.s ?? 0, before?.s ?? 0),
        v: canonicalVelocity(p ?? {}) ?? before?.v ?? 0,
        d: p?.d ?? before?.d ?? null,
        l: p?.l ?? before?.l ?? null,
      };
    });
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
