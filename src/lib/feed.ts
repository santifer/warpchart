// Shared RSS rendering + per-repo event computation for the mission-log feeds:
// the house /feed.xml, per-repo /r/{owner}/{name}/feed.xml, and the Warp Index
// /velocity/feed.xml. One place to build the XML so the three feeds never drift.
// Pure (no fs); imported by route handlers (server) only.
import { dailyCounts } from "./series";
import { detectEvents } from "./events";
import type { MissionEvent, Snapshot, Spike } from "./types";

const DAY = 86_400_000;

export function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface RssItem {
  title: string;
  link: string;
  guid: string;
  ts: string;
  category?: string;
}

export function rssXml(
  channel: { title: string; link: string; description: string },
  items: RssItem[],
): string {
  const body = items
    .map(
      (it) => `  <item>
    <title>${escXml(it.title)}</title>
    <link>${escXml(it.link)}</link>
    <guid isPermaLink="false">${escXml(it.guid)}</guid>
    <pubDate>${new Date(it.ts).toUTCString()}</pubDate>${
      it.category ? `\n    <category>${escXml(it.category)}</category>` : ""
    }
  </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${escXml(channel.title)}</title>
  <link>${escXml(channel.link)}</link>
  <description>${escXml(channel.description)}</description>
  <language>en</language>
${body}
</channel>
</rss>`;
}

// MissionEvents -> RSS items, newest first.
export function eventsToItems(events: MissionEvent[], site: string): RssItem[] {
  return [...events].reverse().map((e) => ({
    title: e.text,
    link: e.url ?? site,
    guid: `${e.ts}:${e.kind}:${e.text}`,
    ts: e.ts,
    category: e.kind,
  }));
}

// A repo's mission-log events from its committed history + star timestamps. The
// shared definition behind every feed and the alerts cron, so a feed and an
// alert can never disagree about what happened.
export function repoEvents(
  history: Snapshot[],
  timestamps: string[],
  spikes: Spike[] = [],
  nowMs = Date.now(),
): MissionEvent[] {
  const firstMs = timestamps.length ? Date.parse(timestamps[0]) : nowMs;
  const lifeDays = Math.min(Math.ceil((nowMs - firstMs) / DAY) + 1, 400);
  const dailyAll = dailyCounts(timestamps, lifeDays, nowMs);
  return detectEvents(history, dailyAll, spikes);
}

export const RSS_HEADERS = {
  "Content-Type": "application/rss+xml; charset=utf-8",
  "Cache-Control": "public, s-maxage=3600",
};
