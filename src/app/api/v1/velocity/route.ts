import { velocityRanking, registryMeta } from "@/lib/api-v1";

export const dynamic = "force-dynamic";
const CACHE = "public, s-maxage=300, stale-while-revalidate=86400";

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit")) || 20;
  return Response.json(
    { fastest: velocityRanking(limit), registry: registryMeta() },
    { headers: { "Cache-Control": CACHE } },
  );
}
