// Natural-language repository recommendation: "what is the best <X>?" Returns
// the catalog repos matching the intent, ranked by validation (stars) and
// momentum (velocity). Cache-only (zero GitHub calls). The discovery brain
// behind the CLI `find` command and the recommend MCP tool.
//   GET /api/v1/find?q=agentic+memory+system&limit=10
import { searchRepos } from "@/lib/search";
import { catalogMeta } from "@/lib/catalog";

export const dynamic = "force-dynamic";
const CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") ?? sp.get("query") ?? "").trim();
  const limit = Number(sp.get("limit")) || 15;
  if (!q) {
    return Response.json(
      { error: "pass ?q= a natural-language query, e.g. ?q=agentic memory system" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { results } = searchRepos(q, limit);
  return Response.json({ query: q, results, catalog: catalogMeta() }, { headers: { "Cache-Control": CACHE } });
}
