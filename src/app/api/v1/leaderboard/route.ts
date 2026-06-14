import { leaderboard, velocityCsv, registryMeta } from "@/lib/api-v1";

export const dynamic = "force-dynamic";
const CACHE = "public, s-maxage=300, stale-while-revalidate=86400";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const limit = Number(sp.get("limit")) || 20;
  const language = sp.get("language") || undefined;
  const rows = leaderboard(limit, language);
  if (sp.get("format") === "csv") {
    return new Response(velocityCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": CACHE,
        "Content-Disposition": 'attachment; filename="warp-index-leaderboard.csv"',
      },
    });
  }
  return Response.json(
    { leaderboard: rows, language: language ?? null, registry: registryMeta() },
    { headers: { "Cache-Control": CACHE } },
  );
}
