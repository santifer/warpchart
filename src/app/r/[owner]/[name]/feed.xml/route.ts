// Per-repo RSS of a tracked repo's mission log: subscribe to one repo's
// milestone gates, overtakes, daily records and spike forensics from any reader.
// Only tracked repos (house + paying tenants + owner portfolio) have recorded
// history; an untracked repo has no events to serve, so it 404s.
import {
  isHostedRepo,
  loadMeta,
  loadHistory,
  loadTimestamps,
  loadForensics,
  loadTenantHistory,
  loadTenantTimestamps,
} from "@/lib/history";
import { isOwnedBy } from "@/lib/config";
import { repoEvents, eventsToItems, rssXml, RSS_HEADERS } from "@/lib/feed";

export const dynamic = "force-dynamic";

const SITE = "https://warpchart.dev";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ owner: string; name: string }> },
) {
  const { owner, name } = await params;
  const repo = `${owner}/${name}`;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return new Response("bad repo", { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const meta = loadMeta();
  const isHouse = meta?.repo?.toLowerCase() === repo.toLowerCase();
  const tracked = isHouse || isHostedRepo(repo) || isOwnedBy(owner);
  if (!tracked) {
    return new Response("not tracked", {
      status: 404,
      headers: { "Cache-Control": "public, s-maxage=3600" },
    });
  }
  const history = isHouse ? loadHistory() : loadTenantHistory(repo);
  const timestamps = isHouse ? loadTimestamps() : loadTenantTimestamps(repo);
  const spikes = isHouse ? loadForensics()?.spikes ?? [] : [];
  const events = repoEvents(history, timestamps, spikes);
  // an owned-but-not-yet-collected repo has no recorded events; 404 rather than
  // serve an empty 200 (matches the contract and avoids a collected/uncollected tell)
  if (!events.length) {
    return new Response("not tracked", { status: 404, headers: { "Cache-Control": "public, s-maxage=3600" } });
  }
  const xml = rssXml(
    {
      title: `${repo} · mission log`,
      link: `${SITE}/r/${repo}`,
      description: `Growth telemetry events for ${repo}: milestone gates, overtakes, daily records and spike forensics.`,
    },
    eventsToItems(events, `${SITE}/r/${repo}`),
  );
  return new Response(xml, { headers: RSS_HEADERS });
}
