// RSS feed of the mission log: subscribe from Slack, Discord or any reader.
// Generated at build time; the hourly snapshot redeploy keeps it fresh.
import { loadHistory, loadMeta, loadTimestamps, loadForensics } from "@/lib/history";
import { dailyCounts } from "@/lib/series";
import { detectEvents } from "@/lib/events";

export const dynamic = "force-static";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET() {
  const meta = loadMeta();
  const history = loadHistory();
  const timestamps = loadTimestamps();
  const nowMs = Date.now();
  const firstMs = timestamps.length ? Date.parse(timestamps[0]) : nowMs;
  const lifeDays = Math.min(Math.ceil((nowMs - firstMs) / 86_400_000) + 1, 400);
  const dailyAll = dailyCounts(timestamps, lifeDays, nowMs);
  const spikes = loadForensics()?.spikes ?? [];
  const events = detectEvents(history, dailyAll, spikes);

  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000";
  const repo = meta?.repo ?? "repository";

  const items = [...events]
    .reverse()
    .map(
      (e) => `  <item>
    <title>${esc(e.text)}</title>
    <link>${esc(e.url ?? site)}</link>
    <guid isPermaLink="false">${esc(e.ts + ":" + e.kind + ":" + e.text)}</guid>
    <pubDate>${new Date(e.ts).toUTCString()}</pubDate>
    <category>${e.kind}</category>
  </item>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${esc(repo)} · mission log</title>
  <link>${site}</link>
  <description>Growth telemetry events for ${esc(repo)}: milestone gates, overtakes, daily records and spike forensics.</description>
  <language>en</language>
${items}
</channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600",
    },
  });
}
