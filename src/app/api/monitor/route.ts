// Server-side watchdog, run by Vercel Cron every 30 minutes: pages the
// operator's phone (Moshi webhook) when the collector goes quiet or the
// GitHub token pool runs low. Stateless alert dedupe: a dead collector
// only pages at the 3h, 6h, 12h and 24h marks (each a single 30-min
// window), not every run of a long incident.
import { lastSnapshot } from "@/lib/history";
import { lowFuel } from "@/lib/github";
import { reqLog } from "@/lib/log";

export const dynamic = "force-dynamic";

const log = reqLog("monitor");
const ALERT_WINDOWS_MIN = [180, 360, 720, 1440];
const WINDOW_MIN = 31; // slightly over the cron cadence so marks never slip

async function page(title: string, message: string) {
  const token = process.env.MOSHI_WEBHOOK_TOKEN;
  if (!token) {
    log.warn("page.skipped", { reason: "MOSHI_WEBHOOK_TOKEN missing", title });
    return;
  }
  try {
    await fetch("https://api.getmoshi.app/api/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, title, message, url: "https://warpchart.dev/api/health" }),
      signal: AbortSignal.timeout(8000),
    });
    log.info("page.sent", { title });
  } catch (err) {
    log.error("page.failed", err, { title });
  }
}

export async function GET(req: Request) {
  // Vercel Cron sends Authorization: Bearer ${CRON_SECRET} automatically
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const snap = lastSnapshot();
  const ageMin = snap ? Math.round((Date.now() - Date.parse(snap.ts)) / 60_000) : null;
  const fuel = lowFuel() ? "low" : "ok";
  const alerts: string[] = [];

  if (ageMin === null) {
    alerts.push("no snapshot data at all");
    await page("⚠️ warpchart collector", "no snapshot data found in the deployment");
  } else {
    const mark = ALERT_WINDOWS_MIN.find((m) => ageMin >= m && ageMin < m + WINDOW_MIN);
    if (mark) {
      alerts.push(`collector quiet ${ageMin}min`);
      await page(
        "⚠️ warpchart collector quiet",
        `last snapshot ${Math.round(ageMin / 60)}h ago (${snap!.ts}). Check the hourly Action: github.com/santifer/warpchart/actions`
      );
    }
  }

  if (fuel === "low") {
    alerts.push("token pool low");
    await page(
      "⛽ warpchart low fuel",
      "every GitHub token is nearly exhausted; long-tail scans are paused until the window resets (max 1h)"
    );
  }

  log.info("tick", { ageMin, fuel, alerts: alerts.length });
  return Response.json(
    { ok: alerts.length === 0, ageMin, fuel, alerts },
    { headers: { "Cache-Control": "no-store" } }
  );
}
