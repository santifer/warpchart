// Private Traffic Vault read. Traffic (views, clones, referrers) is the repo
// OWNER's confidential data, never shown on the public console. This endpoint
// returns a repo's vault ONLY to a caller holding that tenant's secret vaultKey
// (issued on provisioning, sent in the welcome email) or the owner master key.
// Without a valid key it 403s and reveals nothing. No-store: never cached at the
// edge so a private payload cannot leak to the next visitor.
//
// NO EXCEPTIONS, INCLUDING THE HOUSE REPO. Until 2026-08-12 the house repo was
// served here publicly with no key, as the live demo of what the paid vault
// unlocks. That was a deliberate choice made when "our own numbers are public"
// was the policy; Santiago reversed the policy on 2026-08-12 and the exception
// went with it.
//
// Two things made the exception cost more than it looked:
//   - GitHub keeps 14 days of traffic; this vault keeps ~70. The extra 56 days
//     exist nowhere else, so serving them was not "republishing public data",
//     it was publishing data only we hold.
//   - The referrers block is the CHANNEL MIX, not volume. The clone series says
//     how much; referrers say where it comes from, ranked. That is the piece a
//     competitor actually wants and it was never named in the original call.
//
// The public console keeps ONE aggregate (unique cloners, 30d) via the dossier,
// which is enough to verify scale for a sponsor and carries no daily shape and
// no channel mix. Everything with a shape lives behind a key.
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
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "bad request" }, { status: 400, headers: NO_STORE });
  }
  // Every repo, ours included, is gated behind the owner/tenant key. There is
  // no house branch here on purpose: a per-repo exemption is how the last one
  // outlived the policy that justified it.
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
  const vault = await loadTrafficVault(repo);
  return NextResponse.json({ vault, public: false }, { headers: NO_STORE });
}
