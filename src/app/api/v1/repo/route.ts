import { repoStats, registryMeta } from "@/lib/api-v1";

export const dynamic = "force-dynamic";
const CACHE = "public, s-maxage=300, stale-while-revalidate=86400";
const VALID = /^[\w.-]+\/[\w.-]+$/;

export async function GET(request: Request) {
  const repo = (new URL(request.url).searchParams.get("repo") || "").trim();
  if (!VALID.test(repo)) {
    return Response.json({ error: "repo must be 'owner/name'" }, { status: 400 });
  }
  const stats = repoStats(repo);
  if (!stats) {
    return Response.json(
      { error: "repository is not in the worldwide top-1000 registry", repo, registry: registryMeta() },
      { status: 404, headers: { "Cache-Control": CACHE } },
    );
  }
  return Response.json({ ...stats, registry: registryMeta() }, { headers: { "Cache-Control": CACHE } });
}
