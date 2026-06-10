// Dynamic Open Graph card (1200x630), mission-control terminal style.
//   /api/og               -> the tracked tenant (with 7-day sparkline)
//   /api/og?repo=owner/x  -> any repo (live stats, no sparkline)
import { ImageResponse } from "next/og";
import { loadMeta, loadHistory, loadRoute, loadTimestamps } from "@/lib/history";
import { dailyCounts, velocity7d } from "@/lib/series";
import { currentStars, worldwideRank, repoLite } from "@/lib/github";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

const C = {
  void: "#02050a",
  hull: "#08111c",
  grid: "#11263b",
  ink: "#d9e8f5",
  dim: "#5d7a94",
  accent: "#53d6e8",
};

// Fetch a Google Font as TTF once per lambda instance.
const fontCache = new Map<string, Promise<ArrayBuffer | null>>();
function googleFont(family: string): Promise<ArrayBuffer | null> {
  if (!fontCache.has(family)) {
    fontCache.set(
      family,
      (async () => {
        try {
          const css = await fetch(
            `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&display=swap`,
            { headers: { "User-Agent": "Mozilla/5.0" } }
          ).then((r) => r.text());
          const url = css.match(/src: url\((.+?)\)/)?.[1];
          if (!url) return null;
          return await fetch(url).then((r) => r.arrayBuffer());
        } catch {
          return null;
        }
      })()
    );
  }
  return fontCache.get(family)!;
}

interface CardData {
  repo: string;
  desc: string | null;
  rank: number | null;
  stars: number;
  vPerDay: number | null;
  spark: number[] | null; // last 14 daily counts
}

async function tenantData(): Promise<CardData | null> {
  const meta = loadMeta();
  const history = loadHistory();
  const last = history.length ? history[history.length - 1] : null;
  if (!meta || !last) return null;
  const ts = loadTimestamps();
  const nowMs = Date.now();
  const daily = dailyCounts(ts, 14, nowMs);
  return {
    repo: meta.repo,
    desc: meta.description,
    rank: last.rank,
    stars: last.stars,
    vPerDay: Math.round(velocity7d(ts, nowMs)),
    spark: daily.map((d) => d.c),
  };
}

async function repoData(repoParam: string): Promise<CardData | null> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repoParam)) return null;
  const route = loadRoute();
  const idx = route
    ? route.repos.findIndex((p) => p.r.toLowerCase() === repoParam.toLowerCase())
    : -1;
  if (idx >= 0) {
    const e = route!.repos[idx];
    return { repo: e.r, desc: e.d ?? null, rank: idx + 1, stars: e.s, vPerDay: null, spark: null };
  }
  const [owner, name] = repoParam.split("/");
  const lite = await repoLite(owner, name);
  const rank = await worldwideRank(lite.stargazerCount);
  return {
    repo: lite.nameWithOwner,
    desc: lite.description,
    rank,
    stars: lite.stargazerCount,
    vPerDay: null,
    spark: null,
  };
}

function trimWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > 40 ? cut.slice(0, sp) : cut) + "…";
}

function Spark({ values }: { values: number[] }) {
  const w = 360;
  const h = 90;
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 6) - 3}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke={C.accent} strokeWidth={2.5} />
    </svg>
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repoParam = url.searchParams.get("repo");

  let data: CardData | null = null;
  try {
    data = repoParam ? await repoData(repoParam) : await tenantData();
  } catch {
    data = null;
  }
  if (!data) {
    return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const [michroma, jbmono] = await Promise.all([googleFont("Michroma"), googleFont("JetBrains Mono")]);
  const fonts: { name: string; data: ArrayBuffer; style: "normal" }[] = [];
  if (michroma) fonts.push({ name: "Michroma", data: michroma, style: "normal" });
  if (jbmono) fonts.push({ name: "JetBrains Mono", data: jbmono, style: "normal" });

  const owner = data.repo.split("/")[0];
  const mono = jbmono ? "JetBrains Mono" : "monospace";
  const display = michroma ? "Michroma" : mono;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: C.void,
          padding: 56,
          fontFamily: mono,
          color: C.ink,
          border: `2px solid ${C.grid}`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontFamily: display, fontSize: 22, letterSpacing: 10, color: C.dim }}>
            WARPCHART
          </div>
          <div style={{ display: "flex", fontSize: 18, color: C.dim }}>growth telemetry</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 48 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://github.com/${owner}.png?size=128`}
            width={96}
            height={96}
            style={{ border: `2px solid ${C.grid}` }}
            alt=""
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: "#f5fbff" }}>
              {data.repo}
            </div>
            {data.desc ? (
              <div style={{ display: "flex", fontSize: 20, color: C.dim, maxWidth: 900 }}>
                {trimWords(data.desc, 88)}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 64, marginTop: 56, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", fontSize: 16, letterSpacing: 6, color: C.dim }}>WORLD RANK</div>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 700, color: C.accent }}>
              {data.rank !== null ? `#${fmt(data.rank)}` : "n/a"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", fontSize: 16, letterSpacing: 6, color: C.dim }}>STARS</div>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 700 }}>{fmt(data.stars)}</div>
          </div>
          {data.vPerDay !== null ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", fontSize: 16, letterSpacing: 6, color: C.dim }}>VELOCITY</div>
              <div style={{ display: "flex", fontSize: 72, fontWeight: 700 }}>{fmt(data.vPerDay)}/d</div>
            </div>
          ) : null}
          {data.spark ? (
            <div style={{ display: "flex", marginLeft: "auto" }}>
              <Spark values={data.spark} />
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "auto",
            paddingTop: 32,
            borderTop: `1px solid ${C.grid}`,
            fontSize: 17,
            color: C.dim,
          }}
        >
          <div style={{ display: "flex" }}>the route to worldwide rank 1, measured hourly</div>
          <div style={{ display: "flex", color: C.accent }}>open source</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: fonts.length ? fonts : undefined,
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    }
  );
}
