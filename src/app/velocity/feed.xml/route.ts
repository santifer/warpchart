// Warp Index daily-movers RSS: the active overtakes and new top-1000 entrants,
// the lowest-friction external trigger for the investor/builder wedge (no email,
// no consent). Built from the cache-only collision scan; zero API cost.
import { loadCollisions } from "@/lib/history";
import { rssXml, RSS_HEADERS, type RssItem } from "@/lib/feed";

export const dynamic = "force-dynamic";

const SITE = "https://warpchart.dev";

export async function GET() {
  const c = loadCollisions();
  const gen = c?.generated_at ?? new Date().toISOString();
  const day = gen.slice(0, 10);
  const items: RssItem[] = [];
  for (const o of (c?.collisions ?? []).slice(0, 25)) {
    items.push({
      title: `${o.hunter.r} is closing on ${o.victim.r} (gap ${o.gap}, about ${o.etaDays}d)`,
      link: `${SITE}/r/${o.victim.r}`,
      guid: `overtake:${o.hunter.r}:${o.victim.r}:${day}`,
      ts: gen,
      category: "overtake",
    });
  }
  for (const e of (c?.entrants ?? []).slice(0, 25)) {
    items.push({
      title: `${e.r} entered the worldwide top 1000 (#${e.rank}, ${e.s} stars)`,
      link: `${SITE}/r/${e.r}`,
      guid: `entrant:${e.r}:${day}`,
      ts: gen,
      category: "entrant",
    });
  }
  const xml = rssXml(
    {
      title: "Warp Index · daily movers",
      link: `${SITE}/velocity`,
      description:
        "The fastest-moving GitHub repositories: active overtakes and new entrants to the worldwide top 1000, updated daily.",
    },
    items,
  );
  return new Response(xml, { headers: RSS_HEADERS });
}
