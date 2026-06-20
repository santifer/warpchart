// Polar webhook: the moment an order is PAID, the tenant provisions itself —
// the repo lands in the PRIVATE Blob's data/tenants.json (NOT public git: that
// path 404s after the moat cutover, and would leak per-tenant vaultKey secrets),
// the collector fires immediately for the first backwalk, and the alert webhook
// announces the sale. The buyer's console unlocks within minutes: the collector
// run pulls the new tenant from the Blob, backwalks it, and the deploy makes
// loadTenants (disk, mirrored from the Blob) see it.
// Signature scheme: Standard Webhooks (HMAC-SHA256 of "id.timestamp.body").
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { readTenantsBlob, writeTenantsBlob } from "@/lib/tenants-store";

export const maxDuration = 30;

const REPO_API = "https://api.github.com/repos/santifer/warpchart";

function verify(req: NextRequest, body: string): boolean {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) return false;
  const id = req.headers.get("webhook-id") ?? "";
  const ts = req.headers.get("webhook-timestamp") ?? "";
  const sigs = req.headers.get("webhook-signature") ?? "";
  if (!id || !ts || !sigs) return false;
  // standard-webhooks signs with the base64-decoded secret when prefixed,
  // raw bytes otherwise; Polar stores what we provided (raw hex string)
  const keys = [Buffer.from(secret, "utf8")];
  if (secret.startsWith("whsec_")) keys.push(Buffer.from(secret.slice(6), "base64"));
  const payload = `${id}.${ts}.${body}`;
  const given = sigs.split(" ").map((s) => s.split(",")[1] ?? s);
  return keys.some((key) => {
    const expected = crypto.createHmac("sha256", key).update(payload).digest("base64");
    return given.some((g) => {
      try {
        return crypto.timingSafeEqual(Buffer.from(g), Buffer.from(expected));
      } catch {
        return false;
      }
    });
  });
}

async function gh(path: string, init?: RequestInit) {
  const token = process.env.GITHUB_TOKEN;
  return fetch(`${REPO_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

async function provision(
  repo: string,
  plan: "hosted" | "fleet",
): Promise<{ action: string; vaultKey: string | null }> {
  // read + write the registry in the PRIVATE Blob (vaultKeys are secrets; they
  // must never touch public git)
  const tenants = await readTenantsBlob();
  const existing = tenants.find((t) => t.repo.toLowerCase() === repo.toLowerCase());
  if (existing) {
    return { action: "already-provisioned", vaultKey: existing.vaultKey ?? null };
  }
  // per-tenant secret for the PRIVATE traffic vault view (owner-only)
  const vaultKey = crypto.randomUUID();
  tenants.push({ repo, plan, since: new Date().toISOString().slice(0, 10), vaultKey });
  await writeTenantsBlob(tenants);
  // fire the collector now: the buyer's first backwalk should not wait for the
  // next 2h cron tick (best effort). The collector's sync-from-blob picks up the
  // new tenant from the Blob, backwalks it, and the deploy makes loadTenants
  // (disk) see it — console unlocks in minutes.
  await gh("/actions/workflows/collect.yml/dispatches", {
    method: "POST",
    body: JSON.stringify({ ref: "main" }),
  }).catch(() => null);
  return { action: "provisioned", vaultKey };
}

async function notify(text: string) {
  const hook = process.env.ALERT_WEBHOOK_URL;
  if (!hook) return;
  const payload = hook.includes("slack.com") ? { text } : { content: text };
  await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => null);
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  if (!verify(req, body)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const event = JSON.parse(body) as {
    type: string;
    data: {
      id?: string;
      metadata?: Record<string, string>;
      custom_field_data?: Record<string, string>;
      customer?: { email?: string };
      product?: { id?: string; name?: string };
      amount?: number;
    };
  };

  const d = event.data ?? {};
  const repo = (d.metadata?.repo ?? d.custom_field_data?.["github-repo"] ?? "").trim();
  const plan: "hosted" | "fleet" = /fleet/i.test(d.product?.name ?? d.metadata?.plan ?? "")
    ? "fleet"
    : "hosted";
  const email = d.customer?.email ?? "unknown";

  if (event.type === "order.paid") {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      await notify(
        `💸 PAID but no valid repo in order ${d.id}: "${repo}" (${plan}, ${email}). Provision manually + send welcome email.`,
      );
      return NextResponse.json({ ok: true, action: "manual-follow-up" });
    }
    try {
      const { action, vaultKey } = await provision(repo, plan);
      const vaultLine = vaultKey
        ? ` Private traffic vault: https://warpchart.dev/r/${repo}?vault=${vaultKey} (owner-only, include in the welcome email).`
        : "";
      await notify(
        `💸 NEW ${plan.toUpperCase()} MISSION: ${repo} · ${email} · ${action}. ` +
          `Console: https://warpchart.dev/r/${repo} · Send the welcome email (docs/email/welcome-hosted).` +
          vaultLine +
          (plan === "fleet" ? " FLEET: ask for their remaining repos." : ""),
      );
      return NextResponse.json({ ok: true, action });
    } catch (err) {
      await notify(
        `⚠️ PROVISIONING FAILED for ${repo} (${email}): ${err instanceof Error ? err.message : err}. Provision manually.`,
      );
      return NextResponse.json({ ok: false }, { status: 500 });
    }
  }

  if (event.type === "subscription.revoked") {
    await notify(
      `🔕 SUBSCRIPTION REVOKED: ${repo || "unknown repo"} (${email}). Tenant data kept; remove from the PRIVATE Blob tenants.json (not git) when confirmed.`,
    );
  }

  return NextResponse.json({ ok: true });
}
