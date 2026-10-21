// PRIVATE: where a repo placed, day by day, among the worldwide top 1,000 by
// new stars that day (src/lib/velocity-rank.ts). Paid-tier signal built on the
// rank-history moat, so it is gated exactly like /api/v1/rank-history: a secret
// key (?k=) checked against WARPCHART_GOD_KEY, read client-side from
// localStorage by the owner's god mode, so the public pages keep their ISR
// cache. Cache-only: the Blob, never GitHub.
import { repoVelocityRank } from "@/lib/velocity-rank";
import { trendingMarksFor } from "@/lib/trending-marks";

export const dynamic = "force-dynamic";
const VALID = /^[\w.-]+\/[\w.-]+$/;

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const key = process.env.WARPCHART_GOD_KEY;
  const k = sp.get("k") ?? "";
  // no separate "missing key" branch: without the right token this reveals nothing
  if (!key || k !== key) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const repo = (sp.get("repo") || "").trim();
  if (!VALID.test(repo)) {
    return Response.json({ error: "repo must be 'owner/name'" }, { status: 400 });
  }
  const r = await repoVelocityRank(repo);
  if (!r) {
    // the day table is missing or unreadable: an honest 503, never an empty record
    return Response.json({ error: "velocity rank unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  // days seen on GitHub Trending, for the x-axis marks (null = not tracked)
  return Response.json({ repo, ...r, trending: trendingMarksFor(repo) }, { headers: { "Cache-Control": "private, no-store" } });
}
