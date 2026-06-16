// Private Traffic Vault read. Traffic (views, clones, referrers) is the repo
// OWNER's confidential data, never shown on the public console. This endpoint
// returns a repo's vault ONLY to a caller holding that tenant's secret vaultKey
// (issued on provisioning, sent in the welcome email) or the owner master key.
// Without a valid key it 403s and reveals nothing. No-store: never cached at the
// edge so a private payload cannot leak to the next visitor.
//
// ONE exception: the HOUSE repo (the project's own tracked repo) is served
// publicly with no key. Its vault is the live, opt-in demo of what the paid
// Traffic Vault unlocks — "see exactly where career-ops's growth comes from".
// Referrers are aggregate domains, not personal data, and it is our own repo.
import { NextRequest, NextResponse } from "next/server";
import { loadTrafficVault } from "@/lib/traffic";
import { loadTenants, loadMeta } from "@/lib/history";

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
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "bad request" }, { status: 400, headers: NO_STORE });
  }
  // The house repo opts into radical transparency: its vault is public, no key.
  // Every other repo's traffic stays gated behind the owner/tenant key.
  const house = loadMeta()?.repo ?? "";
  const isHouse = !!house && repo.toLowerCase() === house.toLowerCase();
  if (!isHouse) {
    if (!key) {
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
  }
  const vault = await loadTrafficVault(repo);
  return NextResponse.json({ vault, public: isHouse }, { headers: NO_STORE });
}
