// Private Traffic Vault read. Traffic (views, clones, referrers) is the repo
// OWNER's confidential data, never shown on the public console. This endpoint
// returns a repo's vault ONLY to a caller holding that tenant's secret vaultKey
// (issued on provisioning, sent in the welcome email) or the owner master key.
// Without a valid key it 403s and reveals nothing. No-store: never cached at the
// edge so a private payload cannot leak to the next visitor.
import { NextRequest, NextResponse } from "next/server";
import { loadTrafficVault } from "@/lib/traffic";
import { loadTenants } from "@/lib/history";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, private" };

// constant-time-ish compare so we do not leak key length/prefix via timing
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET(req: NextRequest) {
  const repo = (req.nextUrl.searchParams.get("repo") ?? "").trim();
  const key = (req.nextUrl.searchParams.get("key") ?? "").trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !key) {
    return NextResponse.json({ error: "bad request" }, { status: 400, headers: NO_STORE });
  }
  const master = process.env.VAULT_KEY ?? "";
  const tenant = loadTenants().find((t) => t.repo.toLowerCase() === repo.toLowerCase());
  const authorized =
    (master && safeEqual(key, master)) ||
    (tenant?.vaultKey ? safeEqual(key, tenant.vaultKey) : false);
  if (!authorized) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const vault = await loadTrafficVault(repo);
  return NextResponse.json({ vault }, { headers: NO_STORE });
}
