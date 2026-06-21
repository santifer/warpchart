// RSS feed of the HOUSE mission log. Per-repo feeds live at
// /r/{owner}/{name}/feed.xml; the Warp Index movers feed at /velocity/feed.xml.
// All three share src/lib/feed.ts so the XML can never drift.
import { loadHistory, loadMeta, loadTimestamps, loadForensics } from "@/lib/history";
import { repoEvents, eventsToItems, rssXml, RSS_HEADERS } from "@/lib/feed";

export const dynamic = "force-static";

export async function GET() {
  const meta = loadMeta();
  const events = repoEvents(loadHistory(), loadTimestamps(), loadForensics()?.spikes ?? []);
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000";
  const repo = meta?.repo ?? "repository";
  const xml = rssXml(
    {
      title: `${repo} · mission log`,
      link: site,
      description: `Growth telemetry events for ${repo}: milestone gates, overtakes, daily records and spike forensics.`,
    },
    eventsToItems(events, site),
  );
  return new Response(xml, { headers: RSS_HEADERS });
}
