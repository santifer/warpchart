// PRIVATE: world-rank-over-time for ANY recorded top-10k repo. This is the moat
// (the live authoritative rank-of-record; roughly reconstructable from public
// archives but drift-prone, so the dated daily capture is the edge) and the
// headline paid feature, so it is
// gated by a secret key (?k=) checked against WARPCHART_GOD_KEY. It powers the
// owner's private "god mode" competitor analysis: localStorage holds the token,
// a client panel fetches this, and the public /r/ page keeps its ISR cache
// untouched (no server-side cookie read). Cache-only: reads the rank-history
// shards, never GitHub.
import { repoRankTrajectory } from "@/lib/rank-history";

import { authorizeGod } from "@/lib/guest-keys";

export const dynamic = "force-dynamic";
const VALID = /^[\w.-]+\/[\w.-]+$/;

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const k = sp.get("k") ?? "";
  const repo = (sp.get("repo") || "").trim();
  // constant-ish: no separate "missing key" branch that leaks whether a repo
  // exists; without the right token this endpoint reveals nothing.
  // the master key, or a guest key scoped to this repo (src/lib/guest-keys.ts)
  if (!(await authorizeGod(k, repo))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!VALID.test(repo)) {
    return Response.json({ error: "repo must be 'owner/name'" }, { status: 400 });
  }
  // authorized (god-key) surface: serve the FULL record, hot window + cold archive
  // a shard the store could not serve is an outage, not an empty record
  const points = await repoRankTrajectory(repo, { includeArchive: true }).catch(() => null);
  if (!points) {
    return Response.json({ error: "rank history temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(
    { repo, points },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
