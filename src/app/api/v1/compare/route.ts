import { compareRepos, registryMeta } from "@/lib/api-v1";

export const dynamic = "force-dynamic";
const CACHE = "public, s-maxage=300, stale-while-revalidate=86400";
const VALID = /^[\w.-]+\/[\w.-]+$/;

export async function GET(request: Request) {
  const raw = (new URL(request.url).searchParams.get("repos") || "").trim();
  const repos = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!repos.length || !repos.every((r) => VALID.test(r))) {
    return Response.json(
      { error: "repos must be a comma-separated list of 'owner/name' (max 10)" },
      { status: 400 },
    );
  }
  return Response.json(
    { results: compareRepos(repos), registry: registryMeta() },
    { headers: { "Cache-Control": CACHE } },
  );
}
