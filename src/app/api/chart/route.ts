// Embeddable ANIMATED SVG chart of cumulative stars, in the mission-control
// aesthetic. Hand-drawn SVG (no chart library); the animations are pure CSS
// inside the SVG, which survives GitHub's Camo proxy (same mechanism as the
// snake contribution graphs), so the chart draws itself on every README view.
//   /api/chart                         -> the tracked repo (exact history)
//   /api/chart?repo=owner/name         -> ANY repository (sampled history)
//   /api/chart?w=600&h=200&theme=dark  -> size and scheme overrides
import { cachedSampleCurve, tenantCurve, isTenantRepo, withLiveTotal, curveTailV, type Curve } from "@/lib/curve";
import { loadRoute, loadHistory } from "@/lib/history";
import { reqLog } from "@/lib/log";
import { fmt, fmtCompact } from "@/lib/format";
import { fmtEmbed, adaptiveTtl, embedCache, TENANT_EMBED_CACHE } from "@/lib/embed";
import { noteEmbedHit } from "@/lib/embed-track";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DARK = "--bg:#060c12;--bd:#11263b;--gr:#0d1c2b;--dm:#8aa3ba;--ac:#53d6e8;--st:#f5fbff;--wn:#f2c46a;";
const LIGHT = "--bg:#f6f9fc;--bd:#c9d8e4;--gr:#dde7ef;--dm:#43607a;--ac:#0c7d92;--st:#3a5268;--wn:#a05a00;";

// GitHub mark (Octocat), 16x16 viewBox, for the optional ?rank=1 world-rank line.
const GH_MARK = "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z";

function schemeStyle(theme: string | null): string {
  if (theme === "light") return `:root{${LIGHT}}`;
  if (theme === "dark") return `:root{${DARK}}`;
  return `:root{${DARK}}@media (prefers-color-scheme: light){:root{${LIGHT}}}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function seeded(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let seed = h >>> 0;
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const w = Math.min(Math.max(Number(url.searchParams.get("w")) || 800, 320), 1600);
  const h = Math.min(Math.max(Number(url.searchParams.get("h")) || 420, 120), 800);
  const themeParam = url.searchParams.get("theme");
  const theme = themeParam === "light" || themeParam === "dark" ? themeParam : null;
  const repoParam = url.searchParams.get("repo");
  const log = reqLog("chart", { repo: repoParam ?? "tenant", w, h });

  let curve: Curve | null = null;
  // The tenant promises an EXACT counter, so its embed trades cache length
  // for freshness; generic repos show a rounded counter instead, so their
  // TTL stretches with how slowly that rounded display actually moves.
  let exact = false;
  let cacheControl = TENANT_EMBED_CACHE;
  if (repoParam) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repoParam)) {
      return new Response("invalid repo", { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const [owner, name] = repoParam.split("/");
    // ?repo= pointing at the tracked tenant must serve the SAME exact local
    // curve as the no-param branch (the sampled path showed a dashed
    // "estimated" tail for a repo whose full history we hold)
    if (isTenantRepo(repoParam)) {
      curve = tenantCurve();
      if (curve) {
        curve = await withLiveTotal(curve, owner, name);
        exact = true;
      }
    }
    if (!curve) {
      try {
        curve = await log.time("sample", () => cachedSampleCurve(owner, name));
        curve = await withLiveTotal(curve, owner, name);
        // velocity-aware TTL: we already know how fast most repos move
        // (registry diff for the top 1000, curve tail for deep space)
        const hit = loadRoute()?.repos.find((p) => p.r.toLowerCase() === repoParam.toLowerCase());
        cacheControl = embedCache(adaptiveTtl(curve.total, hit?.v ?? curveTailV(curve)));
      } catch (err) {
        const msg = (err as Error).message;
        const notFound = /404|not found/i.test(msg);
        return new Response(notFound ? "repository not found" : "upstream error", {
          status: notFound ? 404 : 502,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }
  } else {
    curve = tenantCurve();
    if (!curve) {
      return new Response("no data", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    const [owner, name] = curve.repo.split("/");
    curve = await withLiveTotal(curve, owner, name);
    exact = true;
  }

  const { repo, total, pts } = curve;
  // Optional WORLD RANK line under the repo label (?rank=1). Cache-only, same
  // sources as the badge: the tenant reads its last hourly snapshot, a top-1000
  // repo reads its registry position. Anything deeper stays blank -- never a
  // new GitHub call, so the chart's no-fetch guarantee holds.
  let worldRank: number | null = null;
  if (url.searchParams.get("rank") === "1") {
    if (exact) {
      const hist = loadHistory();
      worldRank = hist.length ? hist[hist.length - 1].rank : null;
    } else {
      const route = loadRoute();
      const idx = route ? route.repos.findIndex((p) => p.r.toLowerCase() === repo.toLowerCase()) : -1;
      worldRank = idx >= 0 ? idx + 1 : null;
    }
  }
  const archiveFrom = curve.archiveFrom ?? null;
  const exactFrom = curve.exactFrom ?? null;
  // The reveal is one continuous pen. An exact-recent tail (our own daily
  // record beyond the 40K cap) makes the whole line trustworthy, so only a
  // repo with NO recorded window ever draws a dashed estimate here; the
  // interactive page chart renders the bounded estimated middle in detail.
  const dashedFrom = exactFrom !== null ? null : curve.dashedFrom;
  const padL = 16;
  const padR = 78;
  const padT = 40;
  const padB = 34;
  const iw = w - padL - padR;
  const ih = h - padT - padB;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const vMax = Math.max(pts[pts.length - 1].v, total);
  const x = (t: number) => padL + ((t - t0) / Math.max(t1 - t0, 1)) * iw;
  const y = (v: number) => padT + ih - (v / vMax) * ih;

  const solidPts = dashedFrom === null ? pts : pts.slice(0, dashedFrom + 1);
  const seg = (list: { t: number; v: number }[]) =>
    list.map((p, i) => `${i ? "L" : "M"} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const line = seg(solidPts);
  const dashedLine = dashedFrom !== null ? seg(pts.slice(dashedFrom)) : null;
  const area = `${seg(pts)} L ${x(t1).toFixed(1)} ${padT + ih} L ${padL} ${padT + ih} Z`;

  // twinkling star field, deterministic per repo
  const rand = seeded(repo);
  // variable twinkle periods resist habituation better than a uniform beat
  const specks = Array.from({ length: 16 }, () => ({
    x: padL + rand() * iw,
    y: padT + rand() * (ih * 0.82),
    r: rand() < 0.8 ? 0.7 : 1.1,
    d: (rand() * 4).toFixed(2),
    dur: (2.8 + rand() * 2).toFixed(2),
    o: 0.15 + rand() * 0.4,
  }))
    .map(
      (s) =>
        `<circle class="tw" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${s.r}" style="fill:var(--st);animation-delay:${s.d}s;animation-duration:${s.dur}s" opacity="${s.o.toFixed(2)}"/>`
    )
    .join("\n");

  const dateFmt = (t: number) =>
    new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: t1 - t0 > 2.6e10 ? "numeric" : undefined });
  const mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

  const yMarks = [0.25, 0.5, 0.75, 1.0]
    .map((f) => {
      const gy = padT + ih - f * ih;
      return `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${padL + iw}" y2="${gy.toFixed(1)}" style="stroke:var(--gr)" stroke-dasharray="2 6"/>
<text x="${padL + iw + 8}" y="${(gy + 3).toFixed(1)}" font-family="${mono}" font-size="11" style="fill:var(--dm)">${fmtCompact(Math.round(vMax * f))}</text>`;
    })
    .join("\n");

  const axisY = padT + ih;
  const xMarks = [0, 0.25, 0.5, 0.75, 1.0]
    .map((f) => {
      const t = t0 + f * (t1 - t0);
      const tx = padL + f * iw;
      const anchor = f === 0 ? "start" : f === 1 ? "end" : "middle";
      const ax = f === 0 ? padL : f === 1 ? padL + iw : tx;
      return `<line x1="${tx.toFixed(1)}" y1="${axisY}" x2="${tx.toFixed(1)}" y2="${axisY + 4}" style="stroke:var(--dm)" opacity="0.6"/>
<text x="${ax.toFixed(1)}" y="${h - 10}" text-anchor="${anchor}" font-family="${mono}" font-size="11" style="fill:var(--dm)">${dateFmt(t)}</text>`;
    })
    .join("\n");

  const branding =
    w >= 560
      ? `<text x="${w / 2}" y="22" text-anchor="middle" font-family="${mono}" font-size="11" letter-spacing="3" style="fill:var(--dm)" opacity="0.8">WARPCHART</text>`
      : "";

  const endX = x(t1).toFixed(1);
  const endY = y(pts[pts.length - 1].v).toFixed(1);

  // Honest-cap marker: GitHub's REST API stops paginating stargazers at
  // 40K, so the dashed stretch is an estimate. Say so on the chart itself
  // (the market leader hides this; honesty is the brand).
  let capMark = "";
  // Only mark the exact-daily takeover once it spans a visible slice of the
  // width; on a long-lived repo a few recorded days sit on the right edge and
  // a label there just clutters the endpoint. The line is exact either way.
  const exactX = exactFrom !== null && pts[exactFrom] ? x(pts[exactFrom].t) : null;
  const exactWide = exactX !== null && padL + iw - exactX > iw * 0.12;
  if (archiveFrom !== null) {
    // the meaningful seam for repos beyond the cap: api-exact | reconstruction
    const bp = pts[archiveFrom];
    const bx2 = x(bp.t).toFixed(1);
    const by2 = y(bp.v).toFixed(1);
    capMark = `<g class="ar"><line x1="${bx2}" y1="${(Number(by2) - 6).toFixed(1)}" x2="${bx2}" y2="${(Number(by2) + 6).toFixed(1)}" style="stroke:var(--dm)" stroke-width="1" opacity="0.7"/>
<text x="${bx2}" y="${(Number(by2) - 11).toFixed(1)}" text-anchor="middle" font-family="${mono}" font-size="10" style="fill:var(--dm)" opacity="0.85">api exact | gh archive (real, normalized)</text></g>`;
  } else if (exactX !== null && exactWide) {
    // small/younger repo: our exact daily record is the headline improvement
    const bp = pts[exactFrom as number];
    const bx2 = x(bp.t).toFixed(1);
    const by2 = y(bp.v).toFixed(1);
    capMark = `<g class="ar"><line x1="${bx2}" y1="${(Number(by2) - 6).toFixed(1)}" x2="${bx2}" y2="${(Number(by2) + 6).toFixed(1)}" style="stroke:var(--ac)" stroke-width="1" opacity="0.7"/>
<text x="${bx2}" y="${(Number(by2) - 11).toFixed(1)}" text-anchor="middle" font-family="${mono}" font-size="10" style="fill:var(--ac)" opacity="0.9">exact daily record</text></g>`;
  } else if (dashedFrom !== null) {
    const bp = pts[dashedFrom];
    const bx2 = x(bp.t).toFixed(1);
    const by2 = y(bp.v).toFixed(1);
    capMark = `<g class="ar"><line x1="${bx2}" y1="${(Number(by2) - 6).toFixed(1)}" x2="${bx2}" y2="${(Number(by2) + 6).toFixed(1)}" style="stroke:var(--dm)" stroke-width="1" opacity="0.7"/>
<text x="${bx2}" y="${(Number(by2) - 11).toFixed(1)}" text-anchor="middle" font-family="${mono}" font-size="10" style="fill:var(--dm)" opacity="0.85">api cap 40K · dashed = estimated</text></g>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Cumulative stars of ${esc(repo)}">
<style>${schemeStyle(theme)}
/* One looping 12.6s choreography tuned for attention without fatigue.
   A single reveal FRONT sweeps left to right (line and area together,
   headed by a scan beam): fast start for the first-seconds hook, gentle
   deceleration into the arrival. Endpoint lands with overshoot, the
   counter pops once at the payoff, golden double-ring pings beat at
   staggered windows, one shooting star lands a +1 at 57 percent, then a
   graceful fade and a 0.6s blank gap re-arm the next sweep as a fresh
   onset. History is cyan, the living present is gold. Strict XML: no
   angle brackets anywhere in this block. */
.wv{transform-box:fill-box;transform-origin:left center;animation:wv 12.6s linear infinite}
.wg{animation:wg 12.6s ease-out infinite}
.bm{opacity:0;animation:bm 12.6s linear infinite}
.dl{opacity:.45;animation:dlf 1.3s linear infinite}
.dotp{transform-box:fill-box;transform-origin:center;opacity:0;animation:dp 12.6s cubic-bezier(.3,1.4,.4,1) infinite}
.cp{transform-box:fill-box;transform-origin:center;animation:cp 12.6s ease-out infinite}
.pga{transform-box:fill-box;transform-origin:center;opacity:0;animation:pg 12.6s cubic-bezier(.2,.6,.4,1) infinite}
.pgb{animation-delay:.22s}
.ss{opacity:0;animation:ss 12.6s cubic-bezier(.35,0,.7,1) infinite}
.fl{transform-box:fill-box;transform-origin:center;opacity:0;animation:fl 12.6s ease-out infinite}
.pl{opacity:0;animation:pl 12.6s ease-out infinite}
.tw{animation:tw 3.4s ease-in-out infinite}
@keyframes wv{0%{transform:scaleX(0);animation-timing-function:cubic-bezier(.2,.65,.3,1)}17.5%{transform:scaleX(1)}94.4%{transform:scaleX(1)}94.5%,100%{transform:scaleX(0)}}
@keyframes wg{0%,88.9%{opacity:1}94.4%,100%{opacity:0}}
@keyframes bm{0%{transform:translateX(0);opacity:.55;animation-timing-function:cubic-bezier(.2,.65,.3,1)}17.5%{transform:translateX(${iw}px);opacity:.55}20%{transform:translateX(${iw}px);opacity:0}94.4%{transform:translateX(${iw}px);opacity:0}94.5%,100%{transform:translateX(0);opacity:0}}
@keyframes dlf{to{stroke-dashoffset:-8}}
@keyframes dp{0%,17.4%{transform:scale(0);opacity:0}18%{transform:scale(.2);opacity:1}21%{transform:scale(1.35)}23.5%{transform:scale(1)}89.7%{transform:scale(1);opacity:1}94.8%,100%{transform:scale(1);opacity:0}}
@keyframes cp{0%,18.5%{transform:scale(1)}20.5%{transform:scale(1.07)}23.5%,100%{transform:scale(1)}}
@keyframes pg{0%,23%{transform:scale(.3);opacity:0}24.2%{opacity:.85}31%{transform:scale(2.7);opacity:0}45%{transform:scale(.3);opacity:0}46.2%{opacity:.85}53%{transform:scale(2.7);opacity:0}78%{transform:scale(.3);opacity:0}79.2%{opacity:.85}86%{transform:scale(2.7);opacity:0}100%{opacity:0}}
@keyframes ss{0%,56.5%{transform:translate(-170px,-95px);opacity:0}58%{opacity:.95}63.5%{transform:translate(0px,0px);opacity:.95}64.2%,100%{transform:translate(0px,0px);opacity:0}}
@keyframes fl{0%,63%{transform:scale(.2);opacity:0}64.2%{opacity:.9}68.5%{transform:scale(2.2);opacity:0}100%{opacity:0}}
@keyframes pl{0%,63.5%{transform:translateY(0);opacity:0}65.5%{opacity:.95}73%{transform:translateY(-15px);opacity:0}100%{opacity:0}}
@keyframes tw{0%,100%{opacity:.1}50%{opacity:.6}}
@media (prefers-reduced-motion:reduce){.wv{animation:none;transform:scaleX(1)}.wg{animation:none;opacity:1}.dl{animation:none}.bm{animation:none;opacity:0}.dotp{animation:none;opacity:1;transform:scale(1)}.cp{animation:none}.pga,.ss,.fl,.pl,.tw{animation:none;opacity:0}}
</style>
<defs>
  <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" style="stop-color:var(--ac)" stop-opacity="0.30"/>
    <stop offset="100%" style="stop-color:var(--ac)" stop-opacity="0.02"/>
  </linearGradient>
  <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" style="stop-color:var(--ac)" stop-opacity="0"/>
    <stop offset="50%" style="stop-color:var(--ac)" stop-opacity="0.9"/>
    <stop offset="100%" style="stop-color:var(--ac)" stop-opacity="0"/>
  </linearGradient>
  <clipPath id="wipe">
    <rect class="wv" x="${padL - 1}" y="0" width="${iw + 4}" height="${h}"/>
  </clipPath>
</defs>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" style="fill:var(--bg);stroke:var(--bd)"/>
<path d="M 0.5 8 V 0.5 H 8" style="stroke:var(--ac)" fill="none" opacity="0.5"/>
<path d="M ${w - 8} 0.5 H ${w - 0.5} V 8" style="stroke:var(--ac)" fill="none" opacity="0.5"/>
<path d="M 0.5 ${h - 8} V ${h - 0.5} H 8" style="stroke:var(--ac)" fill="none" opacity="0.5"/>
<path d="M ${w - 8} ${h - 0.5} H ${w - 0.5} V ${h - 8}" style="stroke:var(--ac)" fill="none" opacity="0.5"/>
${specks}
<text x="${padL}" y="22" font-family="${mono}" font-size="13" letter-spacing="2" style="fill:var(--dm)">${esc(repo.toUpperCase())}</text>
${worldRank !== null ? `<g transform="translate(${padL},29.9) scale(0.85)" style="fill:var(--dm)"><path d="${GH_MARK}"/></g><text x="${padL + 20}" y="41" font-family="${mono}" font-size="12.5" letter-spacing="0.8" style="fill:var(--dm)"><tspan font-weight="700" style="fill:var(--ac)">#${fmt(worldRank)}</tspan> WORLDWIDE</text>` : ""}
${branding}
<text class="cp" x="${w - 16}" y="22" text-anchor="end" font-family="${mono}" font-size="15" font-weight="700" style="fill:var(--ac)">${exact ? fmt(total) : fmtEmbed(total)} ★</text>
${yMarks}
<line x1="${padL}" y1="${axisY}" x2="${padL + iw}" y2="${axisY}" style="stroke:var(--bd)"/>
<g class="wg" clip-path="url(#wipe)">
  <path d="${area}" fill="url(#fill)"/>
  <g opacity="0.11"><path d="${line}" fill="none" style="stroke:var(--ac)" stroke-width="4"/></g>
  <path d="${line}" fill="none" style="stroke:var(--ac)" stroke-width="1.5"/>
  ${dashedLine ? `<path class="dl" d="${dashedLine}" fill="none" style="stroke:var(--ac)" stroke-width="1.1" stroke-dasharray="2 4"/>` : ""}
</g>
${capMark}
<rect class="bm" x="${padL}" y="${padT - 8}" width="2.5" height="${ih + 14}" fill="url(#beam)"/>
<circle class="pga" cx="${endX}" cy="${endY}" r="5.5" fill="none" style="stroke:var(--wn)" stroke-width="1.1"/>
<circle class="pga pgb" cx="${endX}" cy="${endY}" r="5.5" fill="none" style="stroke:var(--wn)" stroke-width="1.1"/>
<circle class="dotp" cx="${endX}" cy="${endY}" r="7" style="fill:var(--ac)" opacity="0.22"/>
<circle class="dotp" cx="${endX}" cy="${endY}" r="2.8" style="fill:var(--ac)"/>
<g class="ss">
  <line x1="${endX}" y1="${endY}" x2="${(Number(endX) - 24).toFixed(1)}" y2="${(Number(endY) - 13.5).toFixed(1)}" style="stroke:var(--wn)" stroke-width="1.1" opacity="0.7"/>
  <circle cx="${endX}" cy="${endY}" r="1.6" style="fill:var(--wn)"/>
</g>
<circle class="fl" cx="${endX}" cy="${endY}" r="6" fill="none" style="stroke:var(--wn)" stroke-width="1.4"/>
<text class="pl" x="${(Number(endX) - 10).toFixed(1)}" y="${(Number(endY) - 10).toFixed(1)}" text-anchor="end" font-family="${mono}" font-size="10" font-weight="700" style="fill:var(--wn)">+1 ★</text>
${xMarks}
</svg>`;

  // record the first GitHub-camo render of this repo's embed (instant no-op for
  // non-camo UAs; awaited so the Blob write reliably completes on serverless)
  if (repoParam) await noteEmbedHit(req.headers.get("user-agent"), repoParam, "chart");

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": cacheControl,
      "x-warp-request": log.reqId,
    },
  });
}
