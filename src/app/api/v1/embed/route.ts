import { embedSnippet } from "@/lib/api-v1";

export const dynamic = "force-dynamic";
const CACHE = "public, s-maxage=86400, stale-while-revalidate=86400";
const VALID = /^[\w.-]+\/[\w.-]+$/;

export async function GET(request: Request) {
  const repo = (new URL(request.url).searchParams.get("repo") || "").trim();
  if (!VALID.test(repo)) {
    return Response.json({ error: "repo must be 'owner/name'" }, { status: 400 });
  }
  return Response.json(embedSnippet(repo), { headers: { "Cache-Control": CACHE } });
}
