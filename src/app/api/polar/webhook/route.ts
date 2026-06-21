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
import { sendEmail } from "@/lib/email";
import { loadRoute } from "@/lib/history";
import { writeLiveSnapshot } from "@/lib/live-blob";

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
  email: string,
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
  tenants.push({
    repo,
    plan,
    since: new Date().toISOString().slice(0, 10),
    vaultKey,
    // store a valid buyer email so the alerts cron can push events (private)
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : undefined,
  });
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

// The customer-facing welcome email, sent automatically on order.paid. It
// carries the owner-only ?vault= link (the secret the manual flow kept dropping)
// and the "your history started" framing. Plain text, builder-silent voice;
// mirrors docs/email/welcome-hosted.md. Best-effort via Resend (sendEmail never
// throws); a false return falls back to the operator alert.
async function sendWelcomeEmail(
  to: string,
  repo: string,
  plan: "hosted" | "fleet",
  consoleUrl: string,
  vaultUrl: string | null,
  exportUrl: string | null,
): Promise<boolean> {
  const subject = `your mission is live: ${repo} is now under hourly telemetry`;
  const vaultBlock = vaultUrl
    ? `\nYour private traffic vault (owner-only, keep this link): ${vaultUrl}\n` +
      `This is where your clones, views and referrers are kept past GitHub's 14-day wipe.\n` +
      (exportUrl ? `Export everything anytime: ${exportUrl}\n` : "")
    : "";
  const fleetLine =
    plan === "fleet"
      ? `\nYour plan covers up to 10 repositories and ${repo} is the first. Reply with the rest ` +
        `of your fleet (owner/name, one per line) and they will be live within the day.\n`
      : "";
  const text =
    `Welcome aboard.\n\n` +
    `Tracking for ${repo} is active as of this hour. From now on every hour of your star ` +
    `history is recorded permanently: the hourly record that cannot be reconstructed after the ` +
    `fact, and it is yours forever (export anytime, self-host anytime, the software is MIT).\n\n` +
    `Your console: ${consoleUrl}\n` +
    vaultBlock +
    `\nOne honest note about the first hours: the collector has just started walking your ` +
    `repository's history backwards. Most repos resolve within a couple of hours; very large ` +
    `ones take a few more. If a panel still shows a placeholder tonight, that is the backfill ` +
    `at work, not a problem. It fills in on its own.\n\n` +
    `What you have now:\n` +
    `- The full console: velocity, projections, daily ladder, heatmap, rank over time and the mission log\n` +
    `- Embeds with exact live counters for your README\n` +
    `- Alerts for milestone gates and incoming overtakes (reply to wire Slack, Discord or RSS)\n` +
    fleetLine +
    `\nIf anything looks off, just reply: this inbox reaches a human who also happens to be the maintainer.\n\n` +
    `Safe travels to the core,\nSantiago · warpchart.dev\n`;
  // explicit owner-controlled sender (a Resend-verified support identity), so the
  // welcome never silently inherits the internal alerts FROM (embeds@/hello@).
  return sendEmail({
    from: process.env.WELCOME_EMAIL_FROM || "WARPCHART <support@warpchart.dev>",
    to,
    subject,
    text,
    replyTo: process.env.WELCOME_REPLY_TO || "hi@santifer.io",
  });
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
  // fleet tier = the multi-repo plan: matches "fleet" or "team" (and their annual
  // variants) in the product name or the checkout's metadata.plan; everything
  // else (pro / pro-annual / hosted) is the single-repo hosted tier.
  const plan: "hosted" | "fleet" = /fleet|team/i.test(d.product?.name ?? d.metadata?.plan ?? "")
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
      const { action, vaultKey } = await provision(repo, plan, email);
      const consoleUrl = `https://warpchart.dev/r/${repo}`;
      const vaultUrl = vaultKey ? `${consoleUrl}?vault=${vaultKey}` : null;
      const exportUrl = vaultKey
        ? `https://warpchart.dev/api/export?repo=${repo}&vault=${vaultKey}`
        : null;
      // seed a first live snapshot so the buyer sees a real own-repo data point in
      // seconds (FirstLightBanner reads it via /api/tenant-status), instead of
      // waiting for the provisioning redeploy. Free when the repo is in the cached
      // top-10k route; deep-space repos light up after the first collection. Its
      // own try/catch: a snapshot failure must never fail a paid order.
      try {
        const route = action === "provisioned" ? loadRoute() : null;
        const ri = route ? route.repos.findIndex((p) => p.r.toLowerCase() === repo.toLowerCase()) : -1;
        if (route && ri >= 0) {
          const p = route.repos[ri];
          await writeLiveSnapshot(repo, {
            ts: new Date().toISOString(),
            stars: p.s,
            rank: ri + 1,
            milestones: null,
            neighbors: null,
            apex: { r: route.repos[0].r, s: route.repos[0].s },
          });
        }
      } catch {
        /* best-effort: a snapshot failure must never fail a paid order */
      }
      // transactional welcome email to the BUYER (best-effort; the tenant is
      // already provisioned). It carries the owner-only vault link. A missing or
      // malformed customer email, or a Resend failure, falls back to the operator
      // alert below so the welcome is never silently lost.
      const emailed = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
        ? await sendWelcomeEmail(email, repo, plan, consoleUrl, vaultUrl, exportUrl)
        : false;
      const vaultLine = vaultUrl ? ` Vault: ${vaultUrl} (owner-only).` : "";
      await notify(
        `💸 NEW ${plan.toUpperCase()} MISSION: ${repo} · ${email} · ${action}. ` +
          `Console: ${consoleUrl} · welcome email ${emailed ? "SENT automatically ✅" : "NOT sent, send manually (docs/email/welcome-hosted) ⚠️"}.` +
          vaultLine +
          (plan === "fleet" ? " FLEET: ask for their remaining repos." : ""),
      );
      return NextResponse.json({ ok: true, action, emailed });
    } catch (err) {
      await notify(
        `⚠️ PROVISIONING FAILED for ${repo} (${email}): ${err instanceof Error ? err.message : err}. Provision manually.`,
      );
      return NextResponse.json({ ok: false }, { status: 500 });
    }
  }

  if (event.type === "subscription.revoked") {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      await notify(`🔕 REVOKED but no repo on the event (${email}). Remove from the private tenants.json manually.`);
      return NextResponse.json({ ok: true, action: "manual-follow-up" });
    }
    // De-provision: remove the tenant from the PRIVATE registry. The per-tenant
    // vaultKey dies with the record, so the traffic-vault link and the export
    // endpoint stop authorizing once the registry syncs to disk on the next
    // collector deploy. A read/write failure must NOT be swallowed (that would
    // leave a cancelled customer fully provisioned), so it 500s for a manual fix.
    let removed = false;
    try {
      const tenants = await readTenantsBlob();
      const next = tenants.filter((t) => t.repo.toLowerCase() !== repo.toLowerCase());
      if (next.length !== tenants.length) {
        await writeTenantsBlob(next);
        removed = true;
      }
    } catch (err) {
      await notify(
        `⚠️ REVOKE de-provision FAILED for ${repo} (${email}): ${err instanceof Error ? err.message : err}. Remove from the private tenants.json manually.`,
      );
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    await notify(
      `🔕 REVOKED: ${repo} (${email}, sub ${d.id ?? "?"}). ${removed ? "De-provisioned: removed from the registry; the vault and export links are now dead. If this repo has another active subscription, re-provision it." : "Not in the registry (already gone)."} History files remain until the collector prunes them.`,
    );
    return NextResponse.json({ ok: true, removed });
  }

  return NextResponse.json({ ok: true });
}
