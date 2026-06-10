// Embeddable SVG mission badge.
//   /api/badge                -> the tracked tenant (zero API calls)
//   /api/badge?repo=owner/x   -> any repo (free if in the top 1000, else live)
import { loadHistory, loadRoute } from "@/lib/history";
import { currentStars, worldwideRank } from "@/lib/github";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

const COLORS = {
  bg: "#060c12",
  border: "#11263b",
  dim: "#5d7a94",
  ink: "#d9e8f5",
  accent: "#53d6e8",
  warn: "#f2a33c",
};

type Trend = "up" | "down" | "flat" | null;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function badgeSvg(label: string, rank: number | null, stars: number, trend: Trend): string {
  const mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
  const rankTxt = rank !== null ? `#${fmt(rank)}` : "unranked";
  const arrow = trend === "up" ? " ▲" : trend === "down" ? " ▼" : trend === "flat" ? " ▬" : "";
  const arrowColor = trend === "down" ? COLORS.warn : COLORS.accent;
  const starsTxt = `${fmt(stars)} ★`;

  const CH = 6.65; // approx monospace char width at 10.5px
  const pad = 12;
  const gap = 14;
  const labelW = label.length * 6.1 + 4; // letter-spaced, slightly smaller
  const rankW = (rankTxt.length + (arrow ? 2 : 0)) * CH + 4;
  const starsW = starsTxt.length * CH;
  const width = Math.ceil(pad + labelW + gap + rankW + gap + starsW + pad);
  const h = 26;
  const ty = 17;
  const x1 = pad;
  const x2 = pad + labelW + gap;
  const x3 = x2 + rankW + gap;
  const c = COLORS;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" role="img" aria-label="${esc(label)} rank ${esc(rankTxt)}">
<rect x="0.5" y="0.5" width="${width - 1}" height="${h - 1}" fill="${c.bg}" stroke="${c.border}"/>
<path d="M 0.5 6 V 0.5 H 6" stroke="${c.accent}" fill="none" opacity="0.6"/>
<path d="M ${width - 6} 0.5 H ${width - 0.5} V 6" stroke="${c.accent}" fill="none" opacity="0.6"/>
<path d="M 0.5 ${h - 6} V ${h - 0.5} H 6" stroke="${c.accent}" fill="none" opacity="0.6"/>
<path d="M ${width - 6} ${h - 0.5} H ${width - 0.5} V ${h - 6}" stroke="${c.accent}" fill="none" opacity="0.6"/>
<text x="${x1}" y="${ty}" font-family="${mono}" font-size="9" letter-spacing="1.4" fill="${c.dim}">${esc(label)}</text>
<text x="${x2}" y="${ty}" font-family="${mono}" font-size="10.5" font-weight="700" fill="${c.accent}">${esc(rankTxt)}<tspan fill="${arrowColor}">${arrow}</tspan></text>
<text x="${x3}" y="${ty}" font-family="${mono}" font-size="10.5" fill="${c.ink}">${esc(starsTxt)}</text>
</svg>`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repoParam = url.searchParams.get("repo");

  try {
    let rank: number | null = null;
    let stars = 0;
    let trend: Trend = null;

    if (!repoParam) {
      const history = loadHistory();
      const last = history.length ? history[history.length - 1] : null;
      if (!last) return new Response("no data", { status: 404, headers: { "Cache-Control": "no-store" } });
      rank = last.rank;
      stars = last.stars;
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
      const route = loadRoute();
      const idx = route
        ? route.repos.findIndex((p) => p.r.toLowerCase() === repoParam.toLowerCase())
        : -1;
      if (idx >= 0) {
        rank = idx + 1;
        stars = route!.repos[idx].s;
      } else {
        const [owner, name] = repoParam.split("/");
        stars = await currentStars(owner, name);
        rank = await worldwideRank(stars);
      }
    }

    const svg = badgeSvg("WORLD RANK", rank, stars, trend);
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
