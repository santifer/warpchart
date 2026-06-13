import { leaderboard, registryMeta } from "@/lib/api-v1";

export const dynamic = "force-dynamic";
const CACHE = "public, s-maxage=300, stale-while-revalidate=86400";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const limit = Number(sp.get("limit")) || 20;
  const language = sp.get("language") || undefined;
  return Response.json(
    { leaderboard: leaderboard(limit, language), language: language ?? null, registry: registryMeta() },
    { headers: { "Cache-Control": CACHE } },
  );
}
