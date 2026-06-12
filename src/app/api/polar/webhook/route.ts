// Polar webhook: the moment an order is PAID, the tenant provisions
// itself: the repo lands in data/tenants.json via the GitHub contents API
// (the data commit redeploys the site), the collector fires immediately
// for the first backwalk, and the alert webhook announces the sale. The
// buyer's console unlocks within minutes, not at the next cron tick.
// Signature scheme: Standard Webhooks (HMAC-SHA256 of "id.timestamp.body").
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

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

async function provision(repo: string, plan: "hosted" | "fleet"): Promise<string> {
  const cur = await gh("/contents/data/tenants.json?ref=main");
  if (!cur.ok) throw new Error(`tenants.json read ${cur.status}`);
  const file = (await cur.json()) as { content: string; sha: string };
  const tenants = JSON.parse(Buffer.from(file.content, "base64").toString("utf8")) as {
    repo: string;
    plan: string;
    since: string;
  }[];
  if (tenants.some((t) => t.repo.toLowerCase() === repo.toLowerCase())) {
    return "already-provisioned";
  }
  tenants.push({ repo, plan, since: new Date().toISOString().slice(0, 10) });
  const put = await gh("/contents/data/tenants.json", {
    method: "PUT",
    body: JSON.stringify({
      message: `Provision hosted tenant ${repo} (${plan})`,
      content: Buffer.from(JSON.stringify(tenants, null, 2) + "\n").toString("base64"),
      sha: file.sha,
      branch: "main",
    }),
  });
  if (!put.ok) throw new Error(`tenants.json write ${put.status}`);
  // fire the collector now: the buyer's first backwalk should not wait
  // for the next 2h cron tick (best effort)
  await gh("/actions/workflows/collect.yml/dispatches", {
    method: "POST",
    body: JSON.stringify({ ref: "main" }),
  }).catch(() => null);
  return "provisioned";
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
      const action = await provision(repo, plan);
      await notify(
        `💸 NEW ${plan.toUpperCase()} MISSION: ${repo} · ${email} · ${action}. ` +
          `Console: https://warpchart.dev/r/${repo} · Send the welcome email (docs/email/welcome-hosted).` +
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
      `🔕 SUBSCRIPTION REVOKED: ${repo || "unknown repo"} (${email}). Tenant data kept; remove from tenants.json manually when confirmed.`,
    );
  }

  return NextResponse.json({ ok: true });
}
