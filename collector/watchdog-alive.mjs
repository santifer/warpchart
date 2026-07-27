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

const token = process.env.BLOB_READ_WRITE_TOKEN;
// The watchdog runs every 2h. Six hours means it missed three turns, which is
// a stopped schedule rather than a slow one.
const MAX_AGE_H = Number(process.env.WATCHDOG_MAX_AGE_H || 6);

if (!token) {
  console.log("[watchdog-alive] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

try {
  const res = await get("health/latest.json", { access: "private", token });
  if (!res?.stream) {
    console.log("[watchdog-alive] no health report yet (first run?)");
    process.exit(0);
  }
  const report = JSON.parse(await new Response(res.stream).text());
  const ageH = (Date.now() - Date.parse(report.at)) / 3_600_000;
  if (ageH > MAX_AGE_H) {
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
