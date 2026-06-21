// Daily alerts: detect each tracked repo's NEW milestone / overtake / record /
// spike events since the last run and push them to the tenant (email) and the
// operator (webhook). The flagship retention mechanic, sold at every tier and
// previously a manual email reply. Cache-only reads of committed/mirrored
// history; one Resend email per tenant with fresh events. CRON_SECRET required.
import {
  loadMeta,
  loadHistory,
  loadTimestamps,
  loadForensics,
  loadTenants,
  loadTenantHistory,
  loadTenantTimestamps,
} from "@/lib/history";
import { repoEvents } from "@/lib/feed";
import { readAlertsSent, saveAlertsSent } from "@/lib/alerts-store";
import { sendEmail } from "@/lib/email";
import type { MissionEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALERTABLE = new Set(["gate", "overtake", "record", "spike"]);
const SITE = "https://warpchart.dev";
const DAY = 86_400_000;

async function notifyOperator(text: string) {
  const hook = process.env.ALERT_WEBHOOK_URL;
  if (!hook) return;
  const payload = hook.includes("slack.com") ? { text } : { content: text };
  await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => null);
}

function alertEmail(repo: string, fresh: MissionEvent[]): { subject: string; text: string } {
  const name = repo.split("/")[1] ?? repo;
  const lines = fresh.map((e) => `- ${e.text}${e.url ? ` (${e.url})` : ""}`).join("\n");
  const subject = `${name}: ${fresh.length} new growth ${fresh.length === 1 ? "event" : "events"}`;
  const text =
    `New on ${repo} since the last check:\n\n${lines}\n\n` +
    `Console: ${SITE}/r/${repo}\n\n` +
    `You receive this because you track ${repo} on Warpchart. Reply to adjust or stop.\n`;
  return { subject, text };
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("cron not configured", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const auth = req.headers.get("authorization");
  const key = new URL(req.url).searchParams.get("key");
  if (auth !== `Bearer ${secret}` && key !== secret) {
    return new Response("forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const nowMs = Date.now();
  const sent = await readAlertsSent();
  const houseRepo = loadMeta()?.repo ?? null;
  const tenants = loadTenants();

  type Target = { repo: string; email?: string; isHouse: boolean };
  const targets: Target[] = tenants.map((t) => ({ repo: t.repo, email: t.email, isHouse: false }));
  if (houseRepo && !targets.some((t) => t.repo.toLowerCase() === houseRepo.toLowerCase())) {
    targets.push({ repo: houseRepo, isHouse: true });
  }

  let alerted = 0;
  let emailsSent = 0;
  for (const t of targets) {
    const lk = t.repo.toLowerCase();
    const history = t.isHouse ? loadHistory() : loadTenantHistory(t.repo);
    if (!history.length) continue;
    const timestamps = t.isHouse ? loadTimestamps() : loadTenantTimestamps(t.repo);
    const spikes = t.isHouse ? loadForensics()?.spikes ?? [] : [];
    const events = repoEvents(history, timestamps, spikes, nowMs).filter((e) => ALERTABLE.has(e.kind));
    if (!events.length) continue;

    // first run for a repo: baseline to the last 24h so we never blast its whole
    // backlog; afterwards, anything strictly newer than the last alerted ts.
    const cutoff = sent[lk] ?? new Date(nowMs - DAY).toISOString();
    const fresh = events.filter((e) => e.ts > cutoff);
    const latest = events[events.length - 1]?.ts ?? null;

    // quiet window (nothing newer than the watermark): advance the baseline so a
    // later delivery failure can never re-blast already-old events. No-op in
    // steady state (latest <= the stored watermark).
    if (!fresh.length) {
      if (latest && latest > (sent[lk] ?? "")) sent[lk] = latest;
      continue;
    }

    // Deliver, and advance the watermark ONLY on success: a transient Resend
    // failure must retry next run, not silently drop a paid customer's alert.
    let delivered: boolean;
    if (t.email) {
      const { subject, text } = alertEmail(t.repo, fresh);
      delivered = await sendEmail({
        to: t.email,
        subject,
        text,
        from: process.env.ALERTS_EMAIL_FROM || "WARPCHART <alerts@warpchart.dev>",
        replyTo: process.env.WELCOME_REPLY_TO || "hi@santifer.io",
      });
      if (delivered) emailsSent++;
    } else if (t.isHouse) {
      // operator visibility is best-effort; the RSS feed is the durable record
      await notifyOperator(`WARPCHART alerts · ${t.repo}: ${fresh.map((e) => e.text).join(" · ")}`);
      delivered = true;
    } else {
      // a tenant with no email has no channel: do NOT advance, so the alert
      // retries (from the 24h baseline) once an address is added.
      delivered = false;
    }

    if (delivered && latest && latest > (sent[lk] ?? "")) {
      sent[lk] = latest;
      alerted += fresh.length;
    }
  }

  await saveAlertsSent(sent);
  return Response.json(
    { ok: true, targets: targets.length, alerted, emailsSent },
    { headers: { "Cache-Control": "no-store" } },
  );
}
