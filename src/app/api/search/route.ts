// Free-text repo search for the explore landing. The local top-1000
// registry answers first (zero API cost, instant); GitHub's search API
// (a scarce 30/min shared budget) only fills in when the registry has too
// few matches AND fuel remains. Each distinct remote query is cached an
// hour and edge-cached, so autocomplete traffic never multiplies usage.
import { unstable_cache } from "next/cache";
import { searchRepos, lowFuel } from "@/lib/github";
import { loadRoute } from "@/lib/history";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const cachedSearch = unstable_cache(async (q: string) => searchRepos(q, 6), ["explore-search"], {
  revalidate: 3600,
});

function localMatches(q: string) {
  const route = loadRoute();
  if (!route) return [];
  return route.repos
    .filter((p) => p.r.toLowerCase().includes(q))
    .slice(0, 6)
    .map((p) => ({ r: p.r, s: p.s, d: p.d ? p.d.slice(0, 90) : null }));
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2 || q.length > 80) {
    return Response.json({ items: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  const local = localMatches(q);
  if (local.length >= 4 || lowFuel()) {
    return Response.json(
      { items: local },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  }
  try {
    const remote = await cachedSearch(q);
    // registry hits first (they are the famous ones), remote fills the rest
    const seen = new Set(local.map((i) => i.r.toLowerCase()));
    const items = [...local, ...remote.filter((i) => !seen.has(i.r.toLowerCase()))].slice(0, 6);
    return Response.json(
      { items },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch {
    return Response.json({ items: local }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
