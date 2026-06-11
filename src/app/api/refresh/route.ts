// On-demand curve regeneration: expires the cached reconstruction for one
// repo so the next embed/page render rebuilds it from scratch. Linked from
// the embed generator ("data looks stale? refresh it").
import { revalidateTag } from "next/cache";
import { curveTag } from "@/lib/curve";
import { reqLog } from "@/lib/log";

export const dynamic = "force-dynamic";

// Per-instance throttle: enough to keep abuse from burning the GitHub
// quota (Fluid reuses instances); worst case is one rebuild per instance
// per window, and the rebuild itself is the same cost as a cold visit.
const recent = new Map<string, number>();
const WINDOW_MS = 10 * 60_000;

export async function GET(req: Request) {
  const repo = (new URL(req.url).searchParams.get("repo") ?? "").trim();
  const log = reqLog("refresh", { repo });
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return Response.json({ error: "invalid repo" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const key = repo.toLowerCase();
  const now = Date.now();
  const last = recent.get(key) ?? 0;
  if (now - last < WINDOW_MS) {
    const retryMin = Math.ceil((WINDOW_MS - (now - last)) / 60_000);
    return Response.json(
      { ok: false, error: "recently refreshed", retryInMinutes: retryMin },
      { status: 429, headers: { "Cache-Control": "no-store" } }
    );
  }
  recent.set(key, now);
  const [owner, name] = repo.split("/");
  revalidateTag(curveTag(owner, name), { expire: 0 });
  log.info("curve.expired", { repo: key });
  return Response.json(
    { ok: true, repo: key, note: "next render rebuilds the curve from live data" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
