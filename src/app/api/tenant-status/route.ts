// FIRST LIGHT status probe: tells the post-payment banner whether a freshly
// paid repo's console has come online yet. "live" flips true once the
// collector's provisioning redeploy has landed the tenant's first history
// snapshot onto the deployment filesystem. No GitHub calls; no-store so each
// poll reflects the currently-served deployment (the value only changes when
// the provisioning deploy is promoted, which is exactly the moment we want).
import { NextRequest, NextResponse } from "next/server";
import { isHostedRepo, loadTenantHistory } from "@/lib/history";
import { isOwnedBy } from "@/lib/config";
import { readLiveSnapshotFresh } from "@/lib/live-blob";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const repo = (req.nextUrl.searchParams.get("repo") ?? "").trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "bad repo" }, { status: 400, headers: NO_STORE });
  }
  const owner = repo.split("/")[0];
  const hosted = isHostedRepo(repo) || isOwnedBy(owner);
  const live = hosted && loadTenantHistory(repo).length > 0;
  // FIRST LIGHT preview: a seeded live snapshot (written by the Polar webhook at
  // provision time) lets the welcome banner show a real own-repo number within
  // seconds, before the provisioning redeploy makes `live` (disk history) true.
  // Gated on isHostedRepo ONLY (real paying tenants), NOT isOwnedBy: otherwise an
  // unauthenticated poll for any santifer/* string would force an uncached
  // private-Blob read per request. Owned house repos never need first-light.
  const snap = isHostedRepo(repo) && !live ? await readLiveSnapshotFresh(repo) : null;
  const preview = snap ? { stars: snap.stars, rank: snap.rank } : null;
  return NextResponse.json({ repo, hosted, live, preview }, { headers: NO_STORE });
}
