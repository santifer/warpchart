// Who watches the watchdog.
//
// collector/health.mjs asserts that everything else is current, including its
// own output (health/latest.json). That is circular: if the health workflow
// stops running - a cancelled cron, a YAML error, a disabled schedule - the
// only thing that would notice is the thing that stopped. Silence would read
// exactly like health.
//
// So the collector, which runs every two hours for its own reasons, checks that
// the watchdog reported recently. Two independent schedules, each attesting the
// other. Cheap, and it closes the last loop where "no news" was ambiguous.
//
// Usage: BLOB_READ_WRITE_TOKEN=... node collector/watchdog-alive.mjs
// Exit 1 (visible in the run) when the watchdog has gone quiet.
import { get } from "@vercel/blob";
import { maxAgeFromEnv, watchdogStale } from "./health-rules.mjs";

const token = process.env.BLOB_READ_WRITE_TOKEN;
// The limit and why it is 12 h (GitHub delays the 2 h cron to 4.7 h median,
// 8.6 h max) live with their tests in health-rules.mjs.
// A non-numeric override must not switch the alarm off (or on forever).
const MAX_AGE_H = maxAgeFromEnv(process.env.WATCHDOG_MAX_AGE_H);

if (!token) {
  console.log("[watchdog-alive] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

try {
  // useCache:false: a CDN copy of the report would say the watchdog is alive
  // for weeks after it stopped (found 2026-09-26).
  const res = await get("health/latest.json", { access: "private", token, useCache: false });
  if (!res?.stream) {
    console.log("[watchdog-alive] no health report yet (first run?)");
    process.exit(0);
  }
  const report = JSON.parse(await new Response(res.stream).text());
  const ageH = (Date.now() - Date.parse(report.at)) / 3_600_000;
  if (watchdogStale(ageH, MAX_AGE_H)) {
    if (!Number.isFinite(ageH)) {
      console.error(`[watchdog-alive] the health report has no valid timestamp (at: ${JSON.stringify(report.at)}); cannot tell whether the watchdog is alive.`);
      process.exit(1);
    }
    console.error(
      `[watchdog-alive] the health workflow has not reported in ${ageH.toFixed(1)}h ` +
        `(last: ${report.at}). Nothing is checking production right now. ` +
        `Look at: gh run list -R santifer/warpchart -w health.yml`,
    );
    process.exit(1);
  }
  console.log(
    `[watchdog-alive] watchdog reported ${ageH.toFixed(1)}h ago ` +
      `(${report.passed}/${report.total} checks, ${report.counts?.critical ?? 0} critical)`,
  );
} catch (err) {
  // Never break the collector over this: an unreadable report is worth a line,
  // not a failed snapshot.
  console.error(`[watchdog-alive] could not read the health report: ${err?.message ?? err}`);
}
