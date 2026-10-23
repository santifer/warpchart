// PRIVATE: where a repo placed, day by day, among the worldwide top 1,000 by
// new stars that day (src/lib/velocity-rank.ts). Paid-tier signal built on the
// rank-history moat, so it is gated exactly like /api/v1/rank-history: a secret
// key (?k=) checked against WARPCHART_GOD_KEY, read client-side from
// localStorage by the owner's god mode, so the public pages keep their ISR
// cache. Cache-only: the Blob, never GitHub.
import { repoVelocityRank } from "@/lib/velocity-rank";
import { trendingMarksFor } from "@/lib/trending-marks";
import { readTrendingLive } from "@/lib/trending-live";

import { authorizeGod } from "@/lib/guest-keys";

export const dynamic = "force-dynamic";
const VALID = /^[\w.-]+\/[\w.-]+$/;

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const k = sp.get("k") ?? "";
  const repo = (sp.get("repo") || "").trim();
  // no separate "missing key" branch: without the right token this reveals nothing
  // the master key, or a guest key scoped to this repo (src/lib/guest-keys.ts)
  if (!(await authorizeGod(k, repo))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!VALID.test(repo)) {
    return Response.json({ error: "repo must be 'owner/name'" }, { status: 400 });
  }
  const [r, live] = await Promise.all([repoVelocityRank(repo), readTrendingLive()]);
  if (!r) {
    // the day table is missing or unreadable: an honest 503, never an empty record
    return Response.json({ error: "velocity rank unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  // days seen on GitHub Trending (fixed archive + the collector's live record),
  // for the x-axis marks (null = not tracked)
  return Response.json({ repo, ...r, trending: trendingMarksFor(repo, live) }, { headers: { "Cache-Control": "private, no-store" } });
}
