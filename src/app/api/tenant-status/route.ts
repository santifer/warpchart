// FIRST LIGHT status probe: tells the post-payment banner whether a freshly
// paid repo's console has come online yet. "live" flips true once the
// collector's provisioning redeploy has landed the tenant's first history
// snapshot onto the deployment filesystem. No GitHub calls; no-store so each
// poll reflects the currently-served deployment (the value only changes when
// the provisioning deploy is promoted, which is exactly the moment we want).
import { NextRequest, NextResponse } from "next/server";
import { isHostedRepo, loadTenantHistory } from "@/lib/history";
import { isOwnedBy } from "@/lib/config";

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
  return NextResponse.json({ repo, hosted, live }, { headers: NO_STORE });
}
