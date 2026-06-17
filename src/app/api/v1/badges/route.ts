import { classifiedRegistry } from "@/lib/badges";

export const dynamic = "force-dynamic";
const CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";

// One cache-only response with the PRIMARY classification of every badged repo
// in the registry: { "owner/name": "meteor" | "blue-giant" | ... }. Keys are
// lower-cased so the star chart can look up nodes by `repo.toLowerCase()` and
// paint each one's sigil — not just the hero's. No GitHub fetch: pure catalog.
export async function GET() {
  const badges: Record<string, string> = {};
  for (const c of classifiedRegistry()) badges[c.r.toLowerCase()] = c.key;
  return Response.json({ badges }, { headers: { "Cache-Control": CACHE } });
}
