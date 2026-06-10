// Embeddable ANIMATED SVG chart of cumulative stars, in the mission-control
// aesthetic. Hand-drawn SVG (no chart library); the animations are pure CSS
// inside the SVG, which survives GitHub's Camo proxy (same mechanism as the
// snake contribution graphs), so the chart draws itself on every README view.
//   /api/chart                         -> the tracked repo (exact history)
//   /api/chart?repo=owner/name         -> ANY repository (sampled history)
//   /api/chart?w=600&h=200&theme=dark  -> size and scheme overrides
import { unstable_cache } from "next/cache";
import { loadTimestamps, loadMeta, lastSnapshot } from "@/lib/history";
import { repoBasic, stargazerPageFirst } from "@/lib/github";
import { fmt, fmtCompact } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DARK = "--bg:#060c12;--bd:#11263b;--gr:#0d1c2b;--dm:#8aa3ba;--ac:#53d6e8;--st:#f5fbff;";
const LIGHT = "--bg:#f6f9fc;--bd:#c9d8e4;--gr:#dde7ef;--dm:#43607a;--ac:#0c7d92;--st:#3a5268;";

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

interface Curve {
  repo: string;
  total: number;
  pts: { t: number; v: number }[];
  // points from this index on are extrapolated (REST caps stargazer
  // pagination at 40K stars), drawn as a dashed tail
  dashedFrom: number | null;
}

// Sampled curve for arbitrary repos: ~12 spaced stargazer pages, the same
// reconstruction star-history uses. Cached 6h per repo.
async function sampleCurve(owner: string, name: string): Promise<Curve> {
  const basic = await repoBasic(owner, name);
  const reachable = Math.min(basic.s, 40_000);
  const totalPages = Math.max(1, Math.ceil(reachable / 100));
  const SAMPLES = Math.min(12, totalPages);
  const pages = new Set<number>();
  for (let i = 0; i < SAMPLES; i++)
    pages.add(Math.max(1, Math.round(1 + (i * (totalPages - 1)) / Math.max(SAMPLES - 1, 1))));
  const sorted = [...pages].sort((a, b) => a - b);
  const samples = await Promise.all(
    sorted.map(async (p) => ({
      p,
      at: await stargazerPageFirst(owner, name, p).catch(() => null),
    }))
  );
  const pts = samples
    .filter((s) => s.at)
    .map((s) => ({ t: Date.parse(s.at as string), v: (s.p - 1) * 100 + 1 }))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) throw new Error("no stargazer data");
  let dashedFrom: number | null = null;
  if (basic.s > pts[pts.length - 1].v) {
    dashedFrom = pts.length - 1;
    pts.push({ t: Date.now(), v: basic.s });
  }
  return { repo: basic.r, total: basic.s, pts, dashedFrom };
}

const cachedSampleCurve = unstable_cache(sampleCurve, ["embed-chart-curve"], {
  revalidate: 21_600,
});

// Exact curve for the tracked tenant, straight from the local archive.
function tenantCurve(): Curve | null {
  const timestamps = loadTimestamps();
  const meta = loadMeta();
  if (!timestamps.length || !meta) return null;
  const n = timestamps.length;
  const step = Math.max(1, Math.floor(n / 140));
  const pts: { t: number; v: number }[] = [];
  for (let i = 0; i < n; i += step) pts.push({ t: Date.parse(timestamps[i]), v: i + 1 });
  pts.push({ t: Date.parse(timestamps[n - 1]), v: n });
  return { repo: meta.repo, total: lastSnapshot()?.stars ?? n, pts, dashedFrom: null };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const w = Math.min(Math.max(Number(url.searchParams.get("w")) || 800, 320), 1600);
  const h = Math.min(Math.max(Number(url.searchParams.get("h")) || 240, 120), 800);
  const themeParam = url.searchParams.get("theme");
  const theme = themeParam === "light" || themeParam === "dark" ? themeParam : null;
  const repoParam = url.searchParams.get("repo");

  let curve: Curve | null = null;
  let cacheControl = "public, s-maxage=3600, stale-while-revalidate=86400";
  if (repoParam) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repoParam)) {
      return new Response("invalid repo", { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const [owner, name] = repoParam.split("/");
    try {
      curve = await cachedSampleCurve(owner, name);
      cacheControl = "public, s-maxage=21600, stale-while-revalidate=172800";
    } catch (err) {
      const msg = (err as Error).message;
      const notFound = /404|not found/i.test(msg);
      return new Response(notFound ? "repository not found" : "upstream error", {
        status: notFound ? 404 : 502,
        headers: { "Cache-Control": "no-store" },
      });
    }
  } else {
    curve = tenantCurve();
    if (!curve) {
      return new Response("no data", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
  }

  const { repo, total, pts, dashedFrom } = curve;
  const padL = 16;
  const padR = 64;
  const padT = 40;
  const padB = 30;
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

  // polyline length for the draw-on animation
  let len = 0;
  for (let i = 1; i < solidPts.length; i++) {
    const dx = x(solidPts[i].t) - x(solidPts[i - 1].t);
    const dy = y(solidPts[i].v) - y(solidPts[i - 1].v);
    len += Math.sqrt(dx * dx + dy * dy);
  }
  const L = Math.ceil(len + 2);

  // twinkling star field, deterministic per repo
  const rand = seeded(repo);
  const specks = Array.from({ length: 16 }, () => ({
    x: padL + rand() * iw,
    y: padT + rand() * (ih * 0.82),
    r: rand() < 0.8 ? 0.7 : 1.1,
    d: (rand() * 4).toFixed(2),
    o: 0.15 + rand() * 0.4,
  }))
    .map(
      (s) =>
        `<circle class="tw" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${s.r}" style="fill:var(--st);animation-delay:${s.d}s" opacity="${s.o.toFixed(2)}"/>`
    )
    .join("\n");

  const dateFmt = (t: number) =>
    new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: t1 - t0 > 2.6e10 ? "numeric" : undefined });
  const mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

  const yMarks = [0.25, 0.5, 0.75, 1.0]
    .map((f) => {
      const gy = padT + ih - f * ih;
      return `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${padL + iw}" y2="${gy.toFixed(1)}" style="stroke:var(--gr)" stroke-dasharray="2 6"/>
<text x="${padL + iw + 8}" y="${(gy + 3).toFixed(1)}" font-family="${mono}" font-size="9" style="fill:var(--dm)">${fmtCompact(Math.round(vMax * f))}</text>`;
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
<text x="${ax.toFixed(1)}" y="${h - 9}" text-anchor="${anchor}" font-family="${mono}" font-size="9" style="fill:var(--dm)">${dateFmt(t)}</text>`;
    })
    .join("\n");

  const branding =
    w >= 560
      ? `<text x="${w / 2}" y="22" text-anchor="middle" font-family="${mono}" font-size="9" letter-spacing="3" style="fill:var(--dm)" opacity="0.8">WARPCHART</text>`
      : "";

  const endX = x(t1).toFixed(1);
  const endY = y(pts[pts.length - 1].v).toFixed(1);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Cumulative stars of ${esc(repo)}">
<style>${schemeStyle(theme)}
/* The whole chart is ONE looping choreography (14s): draw-on, hold, fade,
   invisible reset. Viewport-triggered start is impossible inside an <img>
   (no JS through Camo), so the loop guarantees every reader catches the
   draw no matter when they scroll to it. */
.ln{stroke-dasharray:${L};stroke-dashoffset:${L};animation:lc 14s cubic-bezier(.25,.6,.3,1) infinite}
.dl{opacity:0;animation:dc 14s ease-out infinite}
.ar{opacity:0;animation:ac 14s ease-out infinite}
.dot{opacity:0;animation:ac 14s ease-out infinite}
.pp{transform-origin:${endX}px ${endY}px;animation:pp 2.8s cubic-bezier(.2,.6,.4,1) infinite}
.tw{animation:tw 3.4s ease-in-out infinite}
@keyframes lc{0%{stroke-dashoffset:${L};opacity:1}18%{stroke-dashoffset:0;opacity:1}85%{stroke-dashoffset:0;opacity:1}90%{stroke-dashoffset:0;opacity:0}90.1%{stroke-dashoffset:${L};opacity:0}100%{stroke-dashoffset:${L};opacity:1}}
@keyframes ac{0%,16%{opacity:0}23%{opacity:1}85%{opacity:1}90%,100%{opacity:0}}
@keyframes dc{0%,19%{opacity:0}26%{opacity:.7}85%{opacity:.7}90%,100%{opacity:0}}
@keyframes pp{0%{transform:scale(.35);opacity:.9}70%{opacity:.12}100%{transform:scale(2.8);opacity:0}}
@keyframes tw{0%,100%{opacity:.1}50%{opacity:.6}}
@media (prefers-reduced-motion:reduce){.ln{animation:none;stroke-dashoffset:0;opacity:1}.ar,.dl,.dot{animation:none;opacity:1}.pp,.tw{animation:none;opacity:0}}
</style>
<defs>
  <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" style="stop-color:var(--ac)" stop-opacity="0.30"/>
    <stop offset="100%" style="stop-color:var(--ac)" stop-opacity="0.02"/>
  </linearGradient>
</defs>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" style="fill:var(--bg);stroke:var(--bd)"/>
<path d="M 0.5 8 V 0.5 H 8" style="stroke:var(--ac)" fill="none" opacity="0.5"/>
<path d="M ${w - 8} 0.5 H ${w - 0.5} V 8" style="stroke:var(--ac)" fill="none" opacity="0.5"/>
<path d="M 0.5 ${h - 8} V ${h - 0.5} H 8" style="stroke:var(--ac)" fill="none" opacity="0.5"/>
<path d="M ${w - 8} ${h - 0.5} H ${w - 0.5} V ${h - 8}" style="stroke:var(--ac)" fill="none" opacity="0.5"/>
${specks}
<text x="${padL}" y="22" font-family="${mono}" font-size="11" letter-spacing="2" style="fill:var(--dm)">${esc(repo.toUpperCase())}</text>
${branding}
<text x="${w - 16}" y="22" text-anchor="end" font-family="${mono}" font-size="12" font-weight="700" style="fill:var(--ac)">${fmt(total)} ★</text>
${yMarks}
<line x1="${padL}" y1="${axisY}" x2="${padL + iw}" y2="${axisY}" style="stroke:var(--bd)"/>
<path class="ar" d="${area}" fill="url(#fill)"/>
<path class="ln" d="${line}" fill="none" style="stroke:var(--ac)" stroke-width="1.5"/>
${dashedLine ? `<path class="dl" d="${dashedLine}" fill="none" style="stroke:var(--ac)" stroke-width="1.2" stroke-dasharray="3 5" opacity="0.7"/>` : ""}
<circle class="pp" cx="${endX}" cy="${endY}" r="5" fill="none" style="stroke:var(--ac)" stroke-width="1"/>
<circle class="dot" cx="${endX}" cy="${endY}" r="2.6" style="fill:var(--ac)"/>
${xMarks}
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}
