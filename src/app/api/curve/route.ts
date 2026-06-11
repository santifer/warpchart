// JSON cumulative curve for the interactive page chart. Shares the cached
// reconstruction with the SVG embed, so neither pays twice.
import { cachedSampleCurve, tenantCurve, isTenantRepo, withLiveTotal } from "@/lib/curve";
import { reqLog } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const repo = (new URL(req.url).searchParams.get("repo") ?? "").trim();
  const log = reqLog("curve", { repo: repo || "tenant" });
  try {
    if (!repo || isTenantRepo(repo)) {
      const curve = tenantCurve(300);
      if (!curve) return Response.json({ error: "no data" }, { status: 404 });
      return Response.json(curve, {
        headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400", "x-warp-request": log.reqId },
      });
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      return Response.json({ error: "invalid repo" }, { status: 400 });
    }
    const [owner, name] = repo.split("/");
    let curve = await log.time("sample", () => cachedSampleCurve(owner, name));
    curve = await withLiveTotal(curve, owner, name);
    return Response.json(curve, {
      headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400", "x-warp-request": log.reqId },
    });
  } catch (err) {
    log.error("failed", err);
    const notFound = /404|not found/i.test((err as Error).message);
    return Response.json(
      { error: notFound ? "repository not found" : "upstream error" },
      { status: notFound ? 404 : 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
