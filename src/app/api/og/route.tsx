// Dynamic Open Graph card (1200x630): the real cumulative curve as the hero.
//   /api/og               -> the tracked tenant (exact local history)
//   /api/og?repo=owner/x  -> any repo (shared cached reconstruction)
// Generated on demand the first time a scraper asks for it (sharing a URL on
// X/Discord/LinkedIn triggers the fetch), then edge-cached.
import { ImageResponse } from "next/og";
import { loadMeta, loadHistory, loadRoute, loadTimestamps } from "@/lib/history";
import { velocity7d } from "@/lib/series";
import { canonicalVelocity } from "@/lib/velocity";
import { worldwideRank, repoLite } from "@/lib/github";
import { cachedSampleCurve, tenantCurve, isTenantRepo, withLiveTotal, type Curve } from "@/lib/curve";
import { fmt } from "@/lib/format";
import { parseRepos, repoColor, shortRepo } from "@/lib/compare";
import { risingOverall } from "@/lib/catalog";
import { repoBadges } from "@/lib/badges";
import { badgeColor } from "@/components/BadgeSigil";
import { ghAvatar } from "@/lib/avatar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const C = {
  void: "#02050a",
  grid: "#11263b",
  ink: "#d9e8f5",
  dim: "#5d7a94",
  accent: "#53d6e8",
  gold: "#ffd34d",
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
}

async function tenantData(): Promise<CardData | null> {
  const meta = loadMeta();
  const history = loadHistory();
  const last = history.length ? history[history.length - 1] : null;
  if (!meta || !last) return null;
  return {
    repo: meta.repo,
    desc: meta.description,
    rank: last.rank,
    stars: last.stars,
    // canonical velocity: the stable route v7 (matches the site + API), with
    // the timestamp-based 7-day rate as the fallback if the focal isn't routed
    vPerDay: Math.round(
      loadRoute()?.repos.find((p) => p.r.toLowerCase() === meta.repo.toLowerCase())?.v7 ??
        velocity7d(loadTimestamps(), Date.now())
    ),
  };
}

// Worldwide rank for a star count, by counting the registry rather than reading
// a position out of it. The registry reorders at most once every 20 hours while
// the star counts around it move constantly, so a stored index goes stale the
// moment anything changes. Counting is always consistent with the number shown.
function rankByStars(stars: number): number | null {
  const route = loadRoute();
  if (!route?.repos.length) return null;
  return route.repos.reduce((n, p) => (p.s > stars ? n + 1 : n), 1);
}

async function repoData(repoParam: string): Promise<CardData | null> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repoParam)) return null;
  const route = loadRoute();
  const idx = route
    ? route.repos.findIndex((p) => p.r.toLowerCase() === repoParam.toLowerCase())
    : -1;
  if (idx >= 0) {
    const e = route!.repos[idx];
    // canonical velocity (route v7 keystone, v fallback) so the card carries the
    // same number as the rest of the site instead of hiding it
    const rv = canonicalVelocity(e);
    // Rank by COUNTING repos above, never by the array index. The registry
    // reorders at most once every 20 hours while each repo's star count is
    // refreshed every 2, so the index is a position from last night attached to
    // this morning's stars. That shipped a card reading "65,139 stars · #307"
    // on the morning career-ops was actually #301 and climbing: the two numbers
    // in the same image came from different clocks, and the stale one was the
    // headline. Counting keeps both on the same clock and costs nothing.
    //
    // Still slightly generous (their counts are last night's too), but it is
    // the same basis the site, the API and the collector already use, so the
    // card can no longer contradict the page it links to.
    const rank = rankByStars(e.s);
    return { repo: e.r, desc: e.d ?? null, rank, stars: e.s, vPerDay: rv != null ? Math.round(rv) : null };
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
  };
}

function trimWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > 40 ? cut.slice(0, sp) : cut) + "…";
}

// Same mapping as the embed SVG, sized for the card's hero band.
function curvePaths(curve: Curve, w: number, h: number) {
  const pts = curve.pts;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const vMax = Math.max(pts[pts.length - 1].v, curve.total);
  // 16px of right headroom so the endpoint marker never clips
  const x = (t: number) => ((t - t0) / Math.max(t1 - t0, 1)) * (w - 16);
  const y = (v: number) => h - 6 - (v / vMax) * (h - 18);
  const df = curve.dashedFrom;
  const solid = df === null ? pts : pts.slice(0, df + 1);
  const seg = (list: { t: number; v: number }[]) =>
    list.map((p, i) => `${i ? "L" : "M"} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  return {
    line: seg(solid),
    dashed: df !== null ? seg(pts.slice(df)) : null,
    area: `${seg(pts)} L ${w} ${h} L 0 ${h} Z`,
    endX: x(pts[pts.length - 1].t),
    endY: y(pts[pts.length - 1].v),
    startYear: new Date(t0).getFullYear(),
  };
}

// Deterministic star specks per repo name.
function specks(repo: string, n: number) {
  let s = 0;
  for (const ch of repo) s = (s * 31 + ch.charCodeAt(0)) % 100000;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  return Array.from({ length: n }, () => ({
    left: Math.round(rand() * 1140 + 20),
    top: Math.round(rand() * 560 + 20),
    size: rand() < 0.75 ? 2 : 3,
    opacity: 0.18 + rand() * 0.4,
  }));
}

async function fetchCurveFor(repo: string): Promise<Curve | null> {
  try {
    if (isTenantRepo(repo)) return tenantCurve(160);
    const [owner, name] = repo.split("/");
    return await withLiveTotal(await cachedSampleCurve(owner, name), owner, name);
  } catch {
    return null;
  }
}

// Overlay share card for /compare: the same reconstructed curves, raced on a
// single axis. Drawing it warms each repo's cached curve for the embed too.
async function compareCard(param: string): Promise<Response> {
  const repos = parseRepos(param, 6);
  if (!repos.length) {
    return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const fetched = await Promise.all(
    repos.map(async (r) => ({ repo: r, curve: await fetchCurveFor(r) }))
  );
  const curves = fetched.filter((x): x is { repo: string; curve: Curve } => !!x.curve && x.curve.pts.length > 1);
  if (!curves.length) {
    return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const [michroma, jbmono] = await Promise.all([googleFont("Michroma"), googleFont("JetBrains Mono")]);
  const fonts: { name: string; data: ArrayBuffer; style: "normal" }[] = [];
  if (michroma) fonts.push({ name: "Michroma", data: michroma, style: "normal" });
  if (jbmono) fonts.push({ name: "JetBrains Mono", data: jbmono, style: "normal" });
  const mono = jbmono ? "JetBrains Mono" : "monospace";
  const display = michroma ? "Michroma" : mono;

  const CW = 1104;
  const CH = 280;
  const t0 = Math.min(...curves.map((c) => c.curve.pts[0].t));
  const t1 = Math.max(...curves.map((c) => c.curve.pts[c.curve.pts.length - 1].t));
  const vMax = Math.max(...curves.map((c) => Math.max(c.curve.total, c.curve.pts[c.curve.pts.length - 1].v)), 1);
  const px = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (CW - 16);
  const py = (v: number) => CH - 6 - (v / vMax) * (CH - 18);
  const pathFor = (c: Curve) =>
    c.pts.map((p, i) => `${i ? "L" : "M"} ${px(p.t).toFixed(1)} ${py(p.v).toFixed(1)}`).join(" ");

  const title = curves.map((c) => shortRepo(c.repo)).join("  vs  ");
  const titleSize = title.length > 52 ? 28 : title.length > 34 ? 34 : 42;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: C.void,
          padding: 48,
          fontFamily: mono,
          color: C.ink,
          border: `2px solid ${C.grid}`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontFamily: display, fontSize: 20, letterSpacing: 10, color: C.dim }}>
            WARPCHART
          </div>
          <div style={{ display: "flex", fontSize: 17, color: C.dim }}>the open source race</div>
        </div>

        <div style={{ display: "flex", fontFamily: display, fontSize: titleSize, color: "#f5fbff", marginTop: 20 }}>
          {title}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 22, marginTop: 14 }}>
          {curves.map((c, i) => (
            <div key={c.repo} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", width: 14, height: 14, background: repoColor(i) }} />
              <div style={{ display: "flex", fontSize: 18, color: C.ink }}>{shortRepo(c.repo)}</div>
              <div style={{ display: "flex", fontSize: 18, color: C.dim }}>{fmt(c.curve.total)}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", marginTop: "auto" }}>
          <svg width={CW} height={CH} viewBox={`0 0 ${CW} ${CH}`}>
            {curves.map((c, i) => (
              <path key={c.repo} d={pathFor(c.curve)} fill="none" stroke={repoColor(i)} strokeWidth={3} />
            ))}
            {curves.map((c, i) => {
              const last = c.curve.pts[c.curve.pts.length - 1];
              return <circle key={c.repo} cx={px(last.t)} cy={py(last.v)} r={6} fill={repoColor(i)} />;
            })}
          </svg>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 10,
            paddingTop: 14,
            borderTop: `1px solid ${C.grid}`,
            fontSize: 16,
            color: C.dim,
          }}
        >
          <div style={{ display: "flex" }}>cumulative stars · real timestamps</div>
          <div style={{ display: "flex", color: C.accent }}>warpchart.dev/compare</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: fonts.length ? fonts : undefined,
      headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400" },
    }
  );
}

// The HOME card is the whole UNIVERSE, not one repo: a star map of the tracked
// field, the route sweeping into the gold worldwide-#1 core, the live risers as
// cyan nodes, and a RISING-NOW readout. This is what a shared warpchart.dev link
// should look like — the product, not a single tenant's stats.
async function indexCard(): Promise<Response> {
  const apex = loadRoute()?.repos?.[0] ?? null;
  // We record the daily world rank of the top 10,000 (the rank-history moat);
  // the catalog is a richer 3k subset. The marketing claim is the full coverage.
  const COVERED = 10000;
  // Risers for the card: real trending (relative growth), but floored to
  // SIGNIFICANT repos so the share card never headlines an obscure +20% micro-spike.
  const risers = risingOverall(50).filter((r) => r.growthPctDay > 0 && r.stars >= 5000).slice(0, 3);

  const [michroma, jbmono] = await Promise.all([googleFont("Michroma"), googleFont("JetBrains Mono")]);
  const fonts: { name: string; data: ArrayBuffer; style: "normal" }[] = [];
  if (michroma) fonts.push({ name: "Michroma", data: michroma, style: "normal" });
  if (jbmono) fonts.push({ name: "JetBrains Mono", data: jbmono, style: "normal" });
  const mono = jbmono ? "JetBrains Mono" : "monospace";
  const display = michroma ? "Michroma" : mono;

  const stars = specks("warpchart-galaxy-index", 120);
  const nodes = [
    { x: 320, y: 250, r: 6 }, { x: 470, y: 430, r: 4 }, { x: 610, y: 300, r: 5 },
    { x: 700, y: 470, r: 4 }, { x: 540, y: 195, r: 4 }, { x: 770, y: 360, r: 6 },
  ];
  const coreX = 880;
  const coreY = 300;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: C.void,
          fontFamily: mono,
          color: C.ink,
          overflow: "hidden",
          border: `2px solid ${C.grid}`,
        }}
      >
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: coreX - 380,
            top: coreY - 380,
            width: 760,
            height: 760,
            borderRadius: 9999,
            background: "radial-gradient(closest-side, rgba(83,214,232,0.20), rgba(255,211,77,0.06) 45%, rgba(2,5,10,0) 72%)",
          }}
        />
        {stars.map((d, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              position: "absolute",
              left: d.left,
              top: d.top,
              width: d.size,
              height: d.size,
              borderRadius: 9999,
              background: "#bfe9ff",
              opacity: d.opacity,
            }}
          />
        ))}
        <svg width={1200} height={630} viewBox="0 0 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
          <path d={`M 70 590 C 360 560, 620 470, ${coreX} ${coreY}`} fill="none" stroke={C.accent} strokeWidth={2.5} opacity={0.5} />
          <path d={`M ${coreX} ${coreY} C 1000 230, 1090 180, 1175 128`} fill="none" stroke={C.accent} strokeWidth={2} strokeDasharray="3 8" opacity={0.4} />
          {nodes.map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r={n.r} fill={C.accent} opacity={0.85} />
          ))}
          <circle cx={coreX} cy={coreY} r={34} fill="none" stroke={C.gold} strokeWidth={1.5} opacity={0.35} />
          <circle cx={coreX} cy={coreY} r={20} fill="none" stroke={C.gold} strokeWidth={1.5} opacity={0.6} />
          <circle cx={coreX} cy={coreY} r={9} fill={C.gold} />
        </svg>

        <div style={{ display: "flex", position: "absolute", left: 56, top: 44, width: 1088, justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontFamily: display, fontSize: 22, letterSpacing: 11, color: C.ink }}>WARPCHART</div>
          <div style={{ display: "flex", fontSize: 17, color: C.dim }}>warpchart.dev</div>
        </div>

        {apex ? (
          <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: coreX + 28, top: coreY - 28, gap: 3 }}>
            <div style={{ display: "flex", fontSize: 13, letterSpacing: 4, color: C.gold }}>WORLDWIDE #1</div>
            <div style={{ display: "flex", fontSize: 21, color: C.ink }}>{shortRepo(apex.r)}</div>
          </div>
        ) : null}

        {risers.length ? (
          <div style={{ display: "flex", flexDirection: "column", position: "absolute", right: 56, top: 96, gap: 5, alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 12, letterSpacing: 4, color: C.dim }}>RISING NOW</div>
            {risers.map((r) => (
              <div key={r.repo} style={{ display: "flex", gap: 9, fontSize: 16, alignItems: "baseline" }}>
                <div style={{ display: "flex", color: C.accent }}>{`+${r.growthPctDay}%/d`}</div>
                <div style={{ display: "flex", color: C.dim }}>{shortRepo(r.repo)}</div>
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 56, bottom: 54, gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", fontFamily: display, fontSize: 58, lineHeight: 1.08 }}>
            <div style={{ display: "flex", color: "#f5fbff" }}>WHERE SOFTWARE</div>
            <div style={{ display: "flex", color: C.accent }}>IS MOVING</div>
          </div>
          <div style={{ display: "flex", fontSize: 19, color: C.dim }}>
            {`the worldwide top ${fmt(COVERED)} · ranked every day · the one history nobody else keeps`}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: fonts.length ? fonts : undefined,
      headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400" },
    }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const compareParam = url.searchParams.get("compare");
  if (compareParam) return compareCard(compareParam);
  const repoParam = url.searchParams.get("repo");
  // No repo => the home card is the whole index (the galaxy), not the tenant.
  if (!repoParam) return indexCard();

  let data: CardData | null = null;
  try {
    data = repoParam ? await repoData(repoParam) : await tenantData();
  } catch {
    data = null;
  }
  if (!data) {
    return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  // The hero curve shares the embed's cached reconstruction: rendering the
  // OG card warms the embed and vice versa. Card degrades to stats-only if
  // the curve is unavailable.
  let curve: Curve | null = null;
  try {
    if (!repoParam || isTenantRepo(repoParam)) {
      // The house repo was the ONLY one whose card missed the live total: every
      // other repo went through withLiveTotal below, while this branch stopped
      // at the collector's 2-hourly reconstruction. So the card most likely to
      // be shared was the one showing the oldest number. Same treatment now.
      // The house card was the only one not showing GitHub's current count.
      // withLiveTotal cannot help here: it only refreshes when the live count
      // exceeds the curve's last y value, and the tenant curve counts STAR
      // EVENTS (about 65.4k) rather than net stars (65.2k), because ~640 people
      // un-starred since April. The event count is permanently higher, so the
      // check never fires. Refresh the total directly instead; the 160-point
      // shape does not change for a few dozen stars.
      const t = tenantCurve(160);
      if (t) {
        try {
          const [tOwner, tName] = (repoParam ?? loadMeta()?.repo ?? "/").split("/");
          if (tOwner && tName) {
            const liveStars = (await repoLite(tOwner, tName)).stargazerCount;
            if (liveStars > t.total) t.total = liveStars;
          }
        } catch { /* keep the collector's total */ }
      }
      curve = t;
    } else {
      const [owner, name] = repoParam.split("/");
      curve = await withLiveTotal(await cachedSampleCurve(owner, name), owner, name);
    }
    if (curve) {
      const fresh = Math.max(data.stars, curve.total);
      // Re-rank against the count we are ABOUT TO PRINT. This line is the whole
      // bug: the card refreshed its star total from the live curve and left the
      // rank computed from the registry's older total, so it published
      // "65,139 stars · #307" when 65,139 stars meant #301. Two numbers, one
      // image, different clocks.
      if (fresh !== data.stars) {
        // ONE definition of rank across the product. The page asks GitHub how
        // many repos are above this count (exact, live); the card used to count
        // the local registry, whose numbers are from last night's reorder, so
        // it read one place better than the page it links to. Same question,
        // same answer now. Registry count stays as the offline fallback.
        data.rank = await worldwideRank(fresh).catch(() => rankByStars(fresh) ?? data.rank);
      }
      data.stars = fresh;
    }
  } catch {
    curve = null;
  }

  const [michroma, jbmono] = await Promise.all([googleFont("Michroma"), googleFont("JetBrains Mono")]);
  const fonts: { name: string; data: ArrayBuffer; style: "normal" }[] = [];
  if (michroma) fonts.push({ name: "Michroma", data: michroma, style: "normal" });
  if (jbmono) fonts.push({ name: "JetBrains Mono", data: jbmono, style: "normal" });

  const owner = data.repo.split("/")[0];
  // The repo's primary classification, drawn as a colored chip beside its name —
  // turns every shared /r/ card into a badge flex (a COMET, a BLUE GIANT...).
  const primaryBadge = (() => {
    const b = repoBadges(data.repo);
    return b.klass ?? b.designations[0] ?? null;
  })();
  const badgeCol = primaryBadge ? badgeColor(primaryBadge.key) : null;
  const mono = jbmono ? "JetBrains Mono" : "monospace";
  const display = michroma ? "Michroma" : mono;
  const CW = 1104;
  const CH = 250;
  const p = curve ? curvePaths(curve, CW, CH) : null;
  const dots = specks(data.repo, 14);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          background: C.void,
          padding: 48,
          fontFamily: mono,
          color: C.ink,
          border: `2px solid ${C.grid}`,
        }}
      >
        {dots.map((d, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              position: "absolute",
              left: d.left,
              top: d.top,
              width: d.size,
              height: d.size,
              borderRadius: 9999,
              background: "#bfe9ff",
              opacity: d.opacity,
            }}
          />
        ))}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontFamily: display, fontSize: 20, letterSpacing: 10, color: C.dim }}>
            WARPCHART
          </div>
          <div style={{ display: "flex", fontSize: 17, color: C.dim }}>warpchart.dev</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 22, marginTop: 26 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ghAvatar(owner, 128)}
            width={68}
            height={68}
            style={{ border: `2px solid ${C.grid}` }}
            alt=""
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: "#f5fbff" }}>
                {data.repo}
              </div>
              {primaryBadge && badgeCol ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 16px",
                    border: `2px solid ${badgeCol}`,
                    borderRadius: 9999,
                  }}
                >
                  <div style={{ display: "flex", width: 14, height: 14, borderRadius: 9999, background: badgeCol }} />
                  <div style={{ display: "flex", fontFamily: display, fontSize: 20, letterSpacing: 3, color: badgeCol }}>
                    {primaryBadge.label}
                  </div>
                </div>
              ) : null}
            </div>
            {data.desc ? (
              <div style={{ display: "flex", fontSize: 18, color: C.dim, maxWidth: 980 }}>
                {trimWords(data.desc, 96)}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 56, marginTop: 22, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", fontSize: 14, letterSpacing: 5, color: C.dim }}>STARS</div>
            {/* no ★ glyph: the Google Fonts subset lacks U+2605 (renders tofu) */}
            <div style={{ display: "flex", fontSize: 56, fontWeight: 700, color: C.accent }}>
              {fmt(data.stars)}
            </div>
          </div>
          {data.rank !== null ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ display: "flex", fontSize: 14, letterSpacing: 5, color: C.dim }}>WORLD RANK</div>
              <div style={{ display: "flex", fontSize: 56, fontWeight: 700 }}>#{fmt(data.rank)}</div>
            </div>
          ) : null}
          {data.vPerDay !== null ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ display: "flex", fontSize: 14, letterSpacing: 5, color: C.dim }}>VELOCITY</div>
              <div style={{ display: "flex", fontSize: 56, fontWeight: 700 }}>{fmt(data.vPerDay)}/d</div>
            </div>
          ) : null}
        </div>

        {p ? (
          <div style={{ display: "flex", marginTop: "auto" }}>
            <svg width={CW} height={CH} viewBox={`0 0 ${CW} ${CH}`}>
              <path d={p.area} fill="rgba(83,214,232,0.10)" />
              <path d={p.line} fill="none" stroke={C.accent} strokeWidth={3} />
              {p.dashed ? (
                <path
                  d={p.dashed}
                  fill="none"
                  stroke={C.accent}
                  strokeWidth={2}
                  strokeDasharray="4 7"
                  opacity={0.6}
                />
              ) : null}
              <circle cx={p.endX} cy={p.endY} r={7} fill={C.gold} />
              <circle cx={p.endX} cy={p.endY} r={13} fill="none" stroke={C.gold} strokeWidth={1.5} opacity={0.5} />
            </svg>
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 10,
            paddingTop: 14,
            borderTop: `1px solid ${C.grid}`,
            fontSize: 16,
            color: C.dim,
          }}
        >
          <div style={{ display: "flex" }}>
            {p ? `${p.startYear} → now · cumulative stars` : "the route to worldwide rank 1, measured hourly"}
          </div>
          <div style={{ display: "flex", color: C.accent }}>open source</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: fonts.length ? fonts : undefined,
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400",
      },
    }
  );
}
