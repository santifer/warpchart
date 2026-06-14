// Rising-by-category feed: the directory's data surface for agents, the CLI and
// investors. Cache-only over data/catalog.json (zero GitHub calls).
//   GET /api/v1/rising                      -> all categories, by heat
//   GET /api/v1/rising?topic=ai-llm         -> rising repos in a category
//   GET /api/v1/rising?language=Rust        -> rising repos in one language
//   &limit=40
import { listCategories, risingInCategory, risingOverall, categoryById, catalogMeta } from "@/lib/catalog";

export const dynamic = "force-dynamic";
const CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const topic = sp.get("topic")?.trim();
  const language = sp.get("language")?.trim() || undefined;
  const limit = Number(sp.get("limit")) || 30;
  const catalog = catalogMeta();

  if (topic) {
    const cat = categoryById(topic);
    const rising = risingInCategory(topic, limit);
    if (!cat || !rising.length) {
      return Response.json({ error: "unknown or empty category", topic, catalog }, { status: 404, headers: { "Cache-Control": CACHE } });
    }
    return Response.json(
      { category: { id: cat.id, label: cat.label, kind: cat.kind }, rising, catalog },
      { headers: { "Cache-Control": CACHE } },
    );
  }

  if (language) {
    return Response.json(
      { language, rising: risingOverall(limit, language), catalog },
      { headers: { "Cache-Control": CACHE } },
    );
  }

  return Response.json({ categories: listCategories().categories, catalog }, { headers: { "Cache-Control": CACHE } });
}
