// Embeddable SVG chart of the tracked repo's cumulative stars, in the
// mission-control aesthetic. Hand-drawn SVG (no chart library on the server).
//   /api/chart                  -> 800x240 cumulative chart
//   /api/chart?w=600&h=200      -> custom size (clamped)
import { loadTimestamps, loadMeta, lastSnapshot } from "@/lib/history";
import { fmt, fmtCompact } from "@/lib/format";

export const dynamic = "force-dynamic";

const DARK = "--bg:#060c12;--bd:#11263b;--gr:#0d1c2b;--dm:#8aa3ba;--ac:#53d6e8;";
const LIGHT = "--bg:#f6f9fc;--bd:#c9d8e4;--gr:#dde7ef;--dm:#43607a;--ac:#0c7d92;";

function schemeStyle(theme: string | null): string {
  if (theme === "light") return `:root{${LIGHT}}`;
  if (theme === "dark") return `:root{${DARK}}`;
  return `:root{${DARK}}@media (prefers-color-scheme: light){:root{${LIGHT}}}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const w = Math.min(Math.max(Number(url.searchParams.get("w")) || 800, 320), 1600);
  const h = Math.min(Math.max(Number(url.searchParams.get("h")) || 240, 120), 800);
  const themeParam = url.searchParams.get("theme");
  const theme = themeParam === "light" || themeParam === "dark" ? themeParam : null;

  const timestamps = loadTimestamps();
  const meta = loadMeta();
  if (!timestamps.length || !meta) {
    return new Response("no data", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const total = lastSnapshot()?.stars ?? timestamps.length;

  // downsample cumulative curve to ~140 points
  const n = timestamps.length;
  const step = Math.max(1, Math.floor(n / 140));
  const pts: { t: number; v: number }[] = [];
  for (let i = 0; i < n; i += step) pts.push({ t: Date.parse(timestamps[i]), v: i + 1 });
  pts.push({ t: Date.parse(timestamps[n - 1]), v: n });

  const padL = 16;
  const padR = 64;
  const padT = 40;
  const padB = 30;
  const iw = w - padL - padR;
  const ih = h - padT - padB;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const x = (t: number) => padL + ((t - t0) / Math.max(t1 - t0, 1)) * iw;
  const y = (v: number) => padT + ih - (v / n) * ih;

  const line = pts.map((p, i) => `${i ? "L" : "M"} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(t1).toFixed(1)} ${padT + ih} L ${padL} ${padT + ih} Z`;

  const dateFmt = (t: number) =>
    new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

  // Y: labeled gridlines at 25/50/75/100% of the current total, on the right.
  const yMarks = [0.25, 0.5, 0.75, 1.0]
    .map((f) => {
      const gy = padT + ih - f * ih;
      return `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${padL + iw}" y2="${gy.toFixed(1)}" style="stroke:var(--gr)" stroke-dasharray="2 6"/>
<text x="${padL + iw + 8}" y="${(gy + 3).toFixed(1)}" font-family="${mono}" font-size="9" style="fill:var(--dm)">${fmtCompact(Math.round(n * f))}</text>`;
    })
    .join("\n");

  // X: five date ticks along the axis.
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

  // Branding sits centered in the header, where nothing can collide with it.
  const branding =
    w >= 560
      ? `<text x="${w / 2}" y="22" text-anchor="middle" font-family="${mono}" font-size="9" letter-spacing="3" style="fill:var(--dm)" opacity="0.8">MISSION CONTROL</text>`
      : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Cumulative stars of ${esc(meta.repo)}">
<style>${schemeStyle(theme)}</style>
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
<text x="${padL}" y="22" font-family="${mono}" font-size="11" letter-spacing="2" style="fill:var(--dm)">${esc(meta.repo.toUpperCase())}</text>
${branding}
<text x="${w - 16}" y="22" text-anchor="end" font-family="${mono}" font-size="12" font-weight="700" style="fill:var(--ac)">${fmt(total)} ★</text>
${yMarks}
<line x1="${padL}" y1="${axisY}" x2="${padL + iw}" y2="${axisY}" style="stroke:var(--bd)"/>
<path d="${area}" fill="url(#fill)"/>
<path d="${line}" fill="none" style="stroke:var(--ac)" stroke-width="1.5"/>
<circle cx="${x(t1).toFixed(1)}" cy="${y(n).toFixed(1)}" r="2.6" style="fill:var(--ac)"/>
${xMarks}
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
