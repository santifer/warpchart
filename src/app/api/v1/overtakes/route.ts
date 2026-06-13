import { overtakes, repoOvertakes, registryMeta } from "@/lib/api-v1";

export const dynamic = "force-dynamic";
const CACHE = "public, s-maxage=300, stale-while-revalidate=86400";
const VALID = /^[\w.-]+\/[\w.-]+$/;

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const repo = (sp.get("repo") || "").trim();
  // ?repo= → who is hunting THIS repo and who it is about to pass
  if (repo) {
    if (!VALID.test(repo)) {
      return Response.json({ error: "repo must be 'owner/name'" }, { status: 400 });
    }
    return Response.json(
      { ...repoOvertakes(repo), registry: registryMeta() },
      { headers: { "Cache-Control": CACHE } },
    );
  }
  // otherwise the global imminent overtakes
  const limit = Number(sp.get("limit")) || 20;
  return Response.json(
    { overtakes: overtakes(limit), registry: registryMeta() },
    { headers: { "Cache-Control": CACHE } },
  );
}
