// Owner data export: the integrity contract's "export anytime" promise made
// real, gated by the per-tenant vault secret (?vault=). Returns the repo's
// recorded snapshots + star timestamps as a JSON download. Cache-only (reads the
// mirrored tenant files); no GitHub calls. The vault secret is issued on
// provisioning and dies when a subscription is revoked, so a cancelled customer
// can no longer export (the registry removal invalidates the key).
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { loadTenants, loadTenantHistory, loadTenantTimestamps } from "@/lib/history";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// constant-time compare so the vault key cannot be probed by timing
function sameSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export async function GET(req: NextRequest) {
  const repo = (req.nextUrl.searchParams.get("repo") ?? "").trim();
  const vault = (req.nextUrl.searchParams.get("vault") ?? "").trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !vault) {
    return NextResponse.json({ error: "repo and vault required" }, { status: 400, headers: NO_STORE });
  }
  const tenant = loadTenants().find((t) => t.repo.toLowerCase() === repo.toLowerCase());
  if (!tenant?.vaultKey || !sameSecret(tenant.vaultKey, vault)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const payload = {
    repo: tenant.repo,
    plan: tenant.plan,
    since: tenant.since,
    exportedAt: new Date().toISOString(),
    snapshots: loadTenantHistory(repo),
    starTimestamps: loadTenantTimestamps(repo),
  };
  const file = `warpchart-${repo.replace("/", "--")}-export.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
