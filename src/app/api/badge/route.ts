// Embeddable SVG mission badge.
//   /api/badge                -> the tracked tenant (zero API calls)
//   /api/badge?repo=owner/x   -> any repo (free if in the top 1000, else live)
//   ?theme=light|dark         -> force a scheme (for GitHub <picture> embeds);
//                                default adapts via prefers-color-scheme.
import { loadHistory, loadMeta, loadRoute } from "@/lib/history";
import { canonicalRepo } from "@/lib/aliases";
import { currentStars, worldwideRank, lowFuel } from "@/lib/github";
import { canonicalVelocity } from "@/lib/velocity";
import { fmt } from "@/lib/format";
import { rankByStars } from "@/lib/rank";
import { fmtEmbed, adaptiveTtl, embedCache, TENANT_EMBED_CACHE } from "@/lib/embed";
import { noteEmbedHit } from "@/lib/embed-track";

export const dynamic = "force-dynamic";

const DARK = "--bg:#060c12;--bd:#11263b;--lb:#8aa3ba;--rk:#53d6e8;--st:#d9e8f5;--dn:#f2a33c;";
const LIGHT = "--bg:#f6f9fc;--bd:#c9d8e4;--lb:#43607a;--rk:#0c7d92;--st:#16293c;--dn:#a05a00;";

type Trend = "up" | "down" | "flat" | null;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function schemeStyle(theme: string | null): string {
  if (theme === "light") return `:root{${LIGHT}}`;
  if (theme === "dark") return `:root{${DARK}}`;
  return `:root{${DARK}}@media (prefers-color-scheme: light){:root{${LIGHT}}}`;
}

function badgeSvg(label: string, rank: number | null, stars: number, trend: Trend, theme: string | null, exact: boolean): string {
  const mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
  const rankTxt = rank !== null ? `#${fmt(rank)}` : "unranked";
  const arrow = trend === "up" ? " ▲" : trend === "down" ? " ▼" : trend === "flat" ? " ▬" : "";
  const starsTxt = `${exact ? fmt(stars) : fmtEmbed(stars)} ★`;

  const CH = 7.9;
  const pad = 12;
  const gap = 14;
  const labelW = label.length * 7.3 + 4;
  const rankW = (rankTxt.length + (arrow ? 2 : 0)) * CH + 4;
  const starsW = starsTxt.length * CH;
  const width = Math.ceil(pad + labelW + gap + rankW + gap + starsW + pad);
  const h = 30;
  const ty = 20;
  const x1 = pad;
  const x2 = pad + labelW + gap;
  const x3 = x2 + rankW + gap;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" role="img" aria-label="${esc(label)} rank ${esc(rankTxt)}">
<style>${schemeStyle(theme)}
.bg{fill:var(--bg);stroke:var(--bd)}.ck{stroke:var(--rk);fill:none;opacity:.6}
.lb{fill:var(--lb)}.rk{fill:var(--rk)}.st{fill:var(--st)}.dn{fill:var(--dn)}
text{font-family:${mono}}</style>
<rect class="bg" x="0.5" y="0.5" width="${width - 1}" height="${h - 1}"/>
<path class="ck" d="M 0.5 6 V 0.5 H 6"/>
<path class="ck" d="M ${width - 6} 0.5 H ${width - 0.5} V 6"/>
<path class="ck" d="M 0.5 ${h - 6} V ${h - 0.5} H 6"/>
<path class="ck" d="M ${width - 6} ${h - 0.5} H ${width - 0.5} V ${h - 6}"/>
<text class="lb" x="${x1}" y="${ty}" font-size="11" letter-spacing="1.4">${esc(label)}</text>
<text class="rk" x="${x2}" y="${ty}" font-size="12.5" font-weight="700">${esc(rankTxt)}<tspan class="${trend === "down" ? "dn" : "rk"}">${arrow}</tspan></text>
<text class="st" x="${x3}" y="${ty}" font-size="12.5">${esc(starsTxt)}</text>
</svg>`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repoParam = url.searchParams.get("repo");
  const themeParam = url.searchParams.get("theme");
  const theme = themeParam === "light" || themeParam === "dark" ? themeParam : null;

  try {
    let rank: number | null = null;
    let stars = 0;
    let trend: Trend = null;
    // exact counter (and a short TTL) for the tenant; rounded counter (and a
    // velocity-stretched TTL) for everyone else -- shown precision should
    // never outrun the freshness the caches can actually deliver
    let exact = false;
    let cacheControl = TENANT_EMBED_CACHE;

    if (!repoParam) {
      const history = loadHistory();
      const last = history.length ? history[history.length - 1] : null;
      if (!last) return new Response("no data", { status: 404, headers: { "Cache-Control": "no-store" } });
      rank = last.rank;
      stars = last.stars;
      exact = true;
      // ONE clock per badge. A live star count next to the snapshot's rank was
      // two readings from two moments in one image; a live count is re-ranked
      // live too, and if either call fails both come from the snapshot.
      const meta = loadMeta();
      if (meta && !lowFuel()) {
        try {
          const [owner, name] = meta.repo.split("/");
          const live = await currentStars(owner, name);
          if (live > stars) {
            rank = await worldwideRank(live);
            stars = live;
          }
        } catch { /* the hourly snapshot, rank and stars together */ }
      }
      const cutoff = Date.now() - 24 * 3600_000;
      let past = null;
      for (const s of history) {
        if (Date.parse(s.ts) <= cutoff) past = s;
        else break;
      }
      if (past) trend = past.rank > last.rank ? "up" : past.rank < last.rank ? "down" : "flat";
    } else {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repoParam)) {
        return new Response("bad repo", { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      // Third-party READMEs embed this URL with the name that was current when
      // they pasted it: resolve renames so those badges survive a transfer.
      const canonical = canonicalRepo(repoParam);
      const route = loadRoute();
      const e = route?.repos.find((p) => p.r.toLowerCase() === canonical.toLowerCase());
      if (e && route) {
        // counted against the registry, never its array position (src/lib/rank.ts)
        rank = rankByStars(route.repos, e.s);
        stars = e.s;
        cacheControl = embedCache(adaptiveTtl(stars, canonicalVelocity(e)));
      } else {
        const [owner, name] = canonical.split("/");
        stars = await currentStars(owner, name);
        rank = await worldwideRank(stars);
        cacheControl = embedCache(adaptiveTtl(stars, null));
      }
    }

    // record the first GitHub-camo render of this repo's badge (no-op unless the
    // UA is camo and the repo is new; awaited for reliable Blob writes)
    if (repoParam) await noteEmbedHit(req.headers.get("user-agent"), repoParam, "badge");

    const svg = badgeSvg("WORLD RANK", rank, stars, trend, theme, exact);
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": cacheControl,
      },
    });
  } catch {
    return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
