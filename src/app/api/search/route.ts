// Free-text repo search for the explore landing. Each distinct query costs
// one GitHub search call per hour (unstable_cache) and the edge caches the
// response, so autocomplete traffic never multiplies API usage.
import { unstable_cache } from "next/cache";
import { searchRepos } from "@/lib/github";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const cachedSearch = unstable_cache(async (q: string) => searchRepos(q, 6), ["explore-search"], {
  revalidate: 3600,
});

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2 || q.length > 80) {
    return Response.json({ items: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const items = await cachedSearch(q);
    return Response.json(
      { items },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch {
    return Response.json({ items: [] }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
