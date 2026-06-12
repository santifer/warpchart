// Shared real-time anchor for HOT explorer scenes (some local ship moving
// fast enough that the map visibly rearranges in minutes). The edge caches
// each scene's response for ~1 minute, so a viral page with a thousand
// simultaneous watchers still costs ONE GraphQL point per minute: every
// client polls the same sorted ?repos= URL and shares the entry.
import { starsBatch, lowFuel } from "@/lib/github";
import { reqLog } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repos = (url.searchParams.get("repos") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!repos.length || repos.length > 30 || repos.some((r) => !/^[\w.-]+\/[\w.-]+$/.test(r))) {
    return Response.json({ error: "bad repos" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (lowFuel()) {
    // high traffic: viewers coast on drift + ISR anchors until fuel returns
    return Response.json(
      { degraded: true },
      { headers: { "Cache-Control": "public, s-maxage=240, stale-while-revalidate=60" } }
    );
  }
  const log = reqLog("live-locals", { repos: repos.length });
  try {
    const stars = await log.time("batch", () => starsBatch(repos));
    return Response.json(
      { ts: Date.now(), stars },
      { headers: { "Cache-Control": "public, s-maxage=55, stale-while-revalidate=30" } }
    );
  } catch (err) {
    log.warn("batch-failed", { err: (err as Error).message.slice(0, 160) });
    return Response.json(
      { degraded: true },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=60" } }
    );
  }
}
