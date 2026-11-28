"use client";

// COMMAND DECK: the whole mission promoted to a fullscreen flight console.
// It does NOT reinvent any card: it REUSES the exact panels from the console
// (GalacticChart, VelocityChart, DailyLadder, RankChart, Projections,
// CurveChart, PulsePanel, UsagePanel) and only relocates them.
//
// Layout, read top-left to bottom-right as the questions a captain asks:
//   bar    who and when (repo, live state, UTC clock, exit)
//   tiles  the eight glanceable numbers, equal cells, never wrapping
//   row 1  where am I and what is next: the star race + milestone rail
//   row 2  how fast: stars per hour → per day → world rank over time
//   row 3  the long run and whether it is real: cumulative, pulse, usage
// On desktop it is a 12-column grid that fills the viewport with no page
// scroll (rows shrink to a readable floor, then the body scrolls); below lg
// it stacks hero first with fixed card heights. Uses the Fullscreen API when
// available and falls back to a fixed overlay (iOS Safari has no element
// fullscreen).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import LiveNumber from "./LiveNumber";
import GalacticChart from "./GalacticChart";
import Panel from "./Panel";
import CurveChart from "./CurveChart";
import VelocityChart from "./VelocityChart";
import DailyLadder from "./DailyLadder";
import RankChart from "./RankChart";
import Projections from "./Projections";
import { PulsePanel, UsagePanel } from "./DossierPanels";
import VitalSignsPanel from "./VitalSignsPanel";
import PrFlowPanel from "./PrFlowPanel";
import TrafficPanel from "./TrafficPanel";
import GodVelocityRank from "./GodVelocityRank";
import MissionLog from "./MissionLog";
import type { VitalsReading } from "@/lib/vitals-reading";
import type { PrFlow } from "@/lib/prflow";
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import type { LadderBand } from "@/lib/ladder-bands";
import type { Dossier } from "@/lib/explorer";
import type { ChartInputs } from "@/lib/types";
import { fmt, shortName } from "@/lib/format";
import { neighborEtas, unsteadyLabel, etaText } from "@/lib/projections";
import { rankDelta7d, weekOverWeekPct } from "@/lib/deck-deltas";

// Trend glyph for a KPI tile (the "stat with sparkline" of Grafana/Datadog
// top rows): shape only, no axis and no labels, drawn from series the bundle
// already carries. `invert` flips it for ranks, where a smaller number is up.
function Spark({ values, invert, title }: { values: number[]; invert?: boolean; title: string }) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const W = 64;
  const H = 22;
  const pts = v.map((x, i) => {
    const y = invert ? ((x - lo) / span) * H : H - ((x - lo) / span) * H;
    return [(i / (v.length - 1)) * W, Math.min(H - 1, Math.max(1, y))] as const;
  });
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg
      viewBox={`-2 -2 ${W + 4} ${H + 4}`}
      preserveAspectRatio="none"
      // the number always wins the width: the glyph takes what is left (up to
      // 64px) and a too-narrow cell drops it (globals.css .deck-spark)
      className="deck-spark hidden h-6 w-16 shrink-0 text-accent sm:block"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <polyline
        points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.55}
        strokeWidth={1.3}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lx} cy={ly} r={1.8} fill="currentColor" />
    </svg>
  );
}

// The status mark next to a tile value: one meaning everywhere, as Grafana's
// guide asks ("blue means good, red means bad"): accent = moving the right way,
// warn = the wrong way. Null renders nothing (no baseline is not "flat").
function Delta({ value, suffix = "%", arrow, title }: { value: number | null; suffix?: string; arrow?: boolean; title: string }) {
  if (value === null) return null;
  // flat is neither good nor bad: grey, "=" / "±0"
  const tone = value > 0 ? "text-accent" : value < 0 ? "text-warn" : "text-faint";
  const text =
    value === 0
      ? arrow ? "=" : `±0${suffix}`
      : arrow
        ? `${value > 0 ? "▲" : "▼"}${Math.abs(value)}`
        : `${value > 0 ? "+" : ""}${value}${suffix}`;
  return (
    <span className={`ml-2 text-sm ${tone}`} title={title}>
      {text}
    </span>
  );
}

// One cell of the KPI strip: label, big value, one line of context. Every
// tile has the same three lines so the strip keeps one baseline and the
// cells never reflow when a slot is empty.
function Tile({
  label,
  children,
  sub,
  tone = "ink",
  big,
  title,
  spark,
}: {
  label: string;
  children: ReactNode;
  sub?: ReactNode;
  tone?: "ink" | "accent" | "warn" | "dim";
  big?: boolean;
  title?: string;
  spark?: ReactNode;
}) {
  // a repo name longer than ~10 characters (code-server, awesome-python…)
  // does not fit a phone's half-width cell at the counters' size
  const long = typeof children === "string" && children.length > 10;
  // a repo name too long for the tile at desktop size (Prompt-Engineering-
  // Guide): the value steps down a size before it truncates, so the name
  // that IS the tile's information stays whole
  const veryLong = typeof children === "string" && children.length > 16;
  const color =
    tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : tone === "dim" ? "text-faint" : "text-ink";
  return (
    <div className="deck-tile flex min-w-0 flex-col gap-1 px-3 py-2 sm:px-3.5" title={title}>
      <span className="module-title !text-micro truncate">{label}</span>
      {/* fixed-height value line, bottom-aligned: big and normal values share
          one baseline across the strip */}
      {/* the sparkline sits a fixed gap after its number, so a wide tile
          does not push it away from the value it belongs to */}
      <span className="flex h-8 items-end gap-5">
        <span
          className={`numeral leading-none ${spark ? "shrink-0" : "truncate"} ${
            big ? "text-2xl sm:text-3xl" : veryLong ? "text-sm 2xl:text-base" : long ? "text-lg sm:text-2xl" : "text-xl sm:text-2xl"
          } ${color} ${
            big && tone === "accent" ? "glow-accent" : ""
          }`}
        >
          {children}
        </span>
        {spark}
      </span>
      {/* phones have no hover tooltip: the context line may wrap to two lines
          there instead of being cut; from sm up it is one line, full text in title */}
      {/* the context line may take two lines: it can carry a staleness
          warning ("rate over a day old") that must not be cut */}
      <span className="numeral line-clamp-2 text-micro leading-snug text-faint">
        {/* a wrap may only fall between "·" segments, never inside one */}
        {typeof sub === "string" ? sub.split(" · ").map((seg) => seg.replace(/ /g, "\u00a0")).join(" · ") : (sub ?? "\u00a0")}
      </span>
    </div>
  );
}

export default function CommandDeck({
  bundle,
  dossier,
  target,
  onPinTarget,
  onExit,
  ladderBands = null,
  vitals,
  prFlow = null,
}: {
  bundle: DashboardBundle;
  dossier: Dossier | null;
  target: string | null;
  onPinTarget: (r: string | null) => void;
  onExit: () => void;
  ladderBands?: LadderBand[] | null;
  // required: a missing reading must not render as the "locked" upsell
  vitals: VitalsReading;
  prFlow?: PrFlow | null;
}) {
  const live = useLive();
  const hostRef = useRef<HTMLDivElement | null>(null);

  const inputs = useMemo<ChartInputs>(
    () => ({
      repo: bundle.meta?.repo ?? "unknown/unknown",
      stars: live.stars,
      rank: live.rank,
      v7d: bundle.v7d,
      vTrend: bundle.vTrend,
      vAsOf: bundle.vAsOf,
      neighbors: live.neighbors,
      milestones: bundle.milestones,
      apex: bundle.apex,
      routeDots: bundle.routeDots,
      routeLandmarks: bundle.routeLandmarks,
      routeAll: bundle.routeAll,
      nowMs: live.nowMs,
    }),
    [bundle, live.stars, live.rank, live.neighbors, live.nowMs]
  );

  // Wall-panel zoom: 1 up to a 1920x1080 frame, then the smaller of the two
  // ratios (a 3440x1440 ultrawide gets 1.33: text, cells and charts grow
  // together and the grid keeps the proportions it was designed in).
  const [wall, setWall] = useState({ z: 1, w: 0, h: 0 });
  useEffect(() => {
    const fit = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const z = Math.max(1, Math.min(w / 1920, h / 1080));
      setWall((p) => (p.z === z && p.w === w && p.h === h ? p : { z, w, h }));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Three views in one frame (wall-panel playlist): GROWTH, HEALTH,
  // AUDIENCE. 1/2/3 or the tabs switch; ROTATE cycles every 45 s for a
  // screen left on. The KPI strip stays fixed across all three.
  const VIEWS = ["growth", "health", "audience"] as const;
  const [view, setView] = useState<(typeof VIEWS)[number]>("growth");
  const [rotate, setRotate] = useState(false);
  // GROWTH has two layouts under trial (Santiago, 3-nov: "quiero ambos modos,
  // que se puedan conmutar"): "race" = the star race leads; "ladder" = the
  // race is a shorter band on top and the daily ladder takes the large cell.
  // L or the button switches; the choice is kept in this browser.
  const [growthLayout, setGrowthLayout] = useState<"race" | "ladder">("race");
  useEffect(() => {
    try {
      // read after mount: localStorage does not exist on the server render
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem("wc_deck_growth") === "ladder") setGrowthLayout("ladder");
    } catch {}
  }, []);
  const toggleLayout = () =>
    setGrowthLayout((l) => {
      const next = l === "race" ? "ladder" : "race";
      try {
        localStorage.setItem("wc_deck_growth", next);
      } catch {}
      return next;
    });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = ["1", "2", "3"].indexOf(e.key);
      if (i >= 0) {
        setView(VIEWS[i]);
        setRotate(false);
      }
      if (e.key === "l" || e.key === "L") toggleLayout();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!rotate) return;
    const t = setInterval(
      () => setView((v) => VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length]),
      45_000,
    );
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotate]);

  // Dedicated 1s clock: the shared live tick is 30s, too coarse for a deck.
  const [clockMs, setClockMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClockMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Measure the hero hole so the chart canvas matches its aspect: wide cells
  // get MORE MAP, not scaled-up pixels. The hole is a grid cell whose size
  // depends on the viewport AND on the fullscreen transition, so it is
  // watched with a ResizeObserver rather than guessed from window resizes.
  const heroHole = useRef<HTMLDivElement | null>(null);
  // The deck shows the console's own star chart (route to the core,
  // instructions, every neighbour): its canvas is 520 units tall and as wide
  // as its hole (1200-2400). The box is capped so the chart never overflows
  // the cell's height. Layout px (clientWidth/Height): under the wall-panel
  // zoom getBoundingClientRect returns screen px.
  const [canvas, setCanvas] = useState<{ fitW: number; maxPx: number; px: number } | null>(null);
  useEffect(() => {
    const el = heroHole.current;
    if (!el) return;
    const measure = () => {
      const r = { width: el.clientWidth, height: el.clientHeight };
      if (r.height < 120 || r.width < 280) return;
      // ladder layout: the race is a wide, short band, so its canvas takes
      // the band's own aspect (the 520-unit height stays) instead of being
      // capped at 2400 and drawn narrow in the middle of the band
      const fitW =
        growthLayout === "ladder"
          ? Math.min(Math.max(Math.round((r.width * 520) / r.height), 1200), 4000)
          : Math.min(Math.max(Math.round(r.width), 1200), 2400);
      const maxPx = Math.floor(r.height * (fitW / 520));
      // the width the svg actually renders at (hole minus px-2, capped by maxPx)
      const px = Math.min(Math.round(r.width) - 16, maxPx);
      const next = { fitW, maxPx, px };
      setCanvas((c) => (c && c.fitW === next.fitW && c.maxPx === next.maxPx && c.px === next.px ? c : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [growthLayout]);

  useEffect(() => {
    const el = hostRef.current;
    if (el && el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
      const onChange = () => {
        if (!document.fullscreenElement) onExit();
      };
      document.addEventListener("fullscreenchange", onChange);
      return () => {
        document.removeEventListener("fullscreenchange", onChange);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      };
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else onExit();
  };

  const repo = bundle.meta?.repo ?? "unknown/unknown";
  const vOwn = bundle.v7d;

  // KPI strip: the urgent dynamic slots (next overtake, threat)
  const etas = neighborEtas(live.neighbors, live.stars, vOwn, { trend: bundle.vTrend, asOf: bundle.vAsOf }, live.nowMs);
  const chase = target ? etas.find((n) => n.r === target) ?? null : null;
  const nextOvertake =
    etas
      .filter((n) => n.gap > 0 && !n.receding && n.etaDays !== null)
      .sort((a, b) => (a.etaDays ?? 1e9) - (b.etaDays ?? 1e9))[0] ?? null;
  const threat =
    etas
      .filter((n) => n.gap <= 0 && n.catchDays !== null)
      .sort((a, b) => (a.catchDays ?? 1e9) - (b.catchDays ?? 1e9))[0] ?? null;

  // Sparkline series for the tiles, all from the bundle (no new numbers).
  // Completed days only: today's partial count would read as a cliff.
  const sparks = useMemo(() => {
    const todayKey = new Date(live.nowMs).toISOString().slice(0, 10);
    const done = bundle.daily.filter((p) => p.d < todayKey);
    const last30 = done.slice(-30);
    const after = done.slice(-30).reduce((a, p) => a + p.c, 0) + live.todayCount;
    const base = live.stars - after;
    const cum = last30.reduce<number[]>((acc, p) => [...acc, (acc.at(-1) ?? base) + p.c], []);
    const since = live.nowMs - 30 * 864e5;
    return {
      stars: [...cum, live.stars],
      rank: bundle.rankHistory.filter((r) => r.t >= since).map((r) => r.rank),
      hour: bundle.hourly.slice(-24).map((h) => h.c),
      day: done.slice(-14).map((p) => p.c),
      v7: bundle.ma7.slice(0, done.length).slice(-30).filter((x): x is number => x !== null),
    };
  }, [bundle.daily, bundle.rankHistory, bundle.hourly, bundle.ma7, live.nowMs, live.stars, live.todayCount]);
  const rankMove = rankDelta7d(bundle.rankHistory, live.rank, live.nowMs);
  const weekPct = weekOverWeekPct(bundle.daily, live.nowMs);
  const live7 = Math.round(bundle.v7d);
  const syncLabel = live.offline ? "SYNC LOST" : live.lastSync === null ? "SYNCING" : "LIVE";

  return (
    <div
      ref={hostRef}
      className="fixed inset-0 z-50 overflow-hidden bg-void"
    >
      <div className="space-backdrop" />
      <div className="space-grid" />
      {/* wall-panel scale: the layout is drawn for a 1920x1080 frame; a larger
          screen (an ultrawide, a TV) zooms the whole deck, type and charts
          together, instead of leaving laptop-size text in giant cells.
          The frame's own size is the viewport divided by the zoom. */}
      <div
        className="relative flex flex-col gap-2 px-3 py-2.5 sm:px-4 sm:py-3"
        style={
          wall.z > 1
            ? { zoom: wall.z, width: wall.w / wall.z, height: wall.h / wall.z }
            : { width: "100%", height: "100%" }
        }
      >

      {/* bar: identity and time, one thin line */}
      <div className="relative flex shrink-0 items-center justify-between gap-4 px-1">
        <div className="flex min-w-0 items-center gap-3">
          {bundle.meta?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bundle.meta.avatar_url}
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 shrink-0 border border-grid"
            />
          ) : null}
          {/* phones show the repo name only; the owner is one tap away */}
          <span className="font-display truncate text-sm uppercase tracking-[0.2em] text-star">
            <span className="hidden sm:inline">{repo}</span>
            <span className="sm:hidden">{repo.split("/")[1] ?? repo}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5" title={syncLabel} aria-label={syncLabel}>
            <span
              className={
                live.offline
                  ? "h-[7px] w-[7px] rounded-full bg-warn"
                  : live.lastSync === null
                    ? "h-[7px] w-[7px] animate-pulse rounded-full bg-faint"
                    : "pulse-dot"
              }
            />
            <span className="numeral hidden text-micro tracking-[0.2em] text-dim sm:inline">{syncLabel}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <nav className="flex items-center gap-1" aria-label="deck views">
            {VIEWS.map((v, i) => (
              <button
                key={v}
                onClick={() => {
                  setView(v);
                  setRotate(false);
                }}
                aria-pressed={view === v}
                className={`numeral border px-2 py-0.5 text-micro tracking-[0.2em] transition-colors ${
                  view === v ? "border-accent/60 text-accent" : "border-grid text-dim hover:text-ink"
                }`}
              >
                <span className="text-faint">{i + 1}</span> {v.toUpperCase()}
              </button>
            ))}
            <button
              onClick={() => setRotate((r) => !r)}
              aria-pressed={rotate}
              title="show GROWTH, HEALTH and AUDIENCE in turn, 45 s each, for a screen left on; press a tab or 1/2/3 to stop"
              // a mode, not a fourth view: no tab frame, set apart by a divider
              className={`numeral ml-2 hidden border-l border-grid py-0.5 pl-4 text-micro tracking-[0.2em] transition-colors sm:inline ${
                rotate ? "text-accent" : "text-faint hover:text-ink"
              }`}
            >
              {rotate ? "■ STOP CYCLE" : "▶ AUTO-CYCLE"}
            </button>
            {view === "growth" ? (
              <button
                onClick={toggleLayout}
                title="GROWTH layout under trial: race-led or ladder-led (key L); kept in this browser"
                className="numeral hidden py-0.5 pl-3 text-micro tracking-[0.2em] text-faint transition-colors hover:text-ink sm:inline"
              >
                <span className="text-faint">L</span> {growthLayout === "race" ? "RACE-LED" : "LADDER-LED"}
              </button>
            ) : null}
          </nav>
          <span className="numeral hidden text-sm text-dim sm:inline" suppressHydrationWarning>
            {new Date(clockMs).toISOString().slice(11, 19)} UTC
          </span>
          <button
            onClick={exit}
            className="numeral border border-grid px-2.5 py-1 text-micro tracking-[0.2em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
          >
            ✕ EXIT<span className="hidden sm:inline"> DECK</span>
          </button>
        </div>
      </div>

      {/* tiles: the eight numbers worth a glance, in reading order
          (state → pace → what comes next). Empty slots keep their cell. */}
      <div className="hud deck-tiles relative shrink-0">
        <Tile label="STARS" tone="accent" big title="GitHub stargazers, live; the line is the total over the last 30 days" spark={<Spark values={sparks.stars} title="total stars, last 30 days" />} sub={`since ${bundle.meta?.created_at?.slice(0, 10) ?? "launch"}`}>
          <LiveNumber value={live.stars} locales="en-US" />
        </Tile>
        <Tile label="RANK" big title="world rank by total stars among all public repos; ▲/▼ = positions vs 7 days ago" sub="worldwide" spark={<Spark values={sparks.rank} invert title="world rank, last 30 days (up = better)" />}>
          {live.rank !== null ? (
            <>
              <span className="text-faint">#</span>
              <LiveNumber value={live.rank} locales="en-US" />
              <Delta value={rankMove} arrow title="positions gained since 7 days ago" />
            </>
          ) : (
            "n/a"
          )}
        </Tile>
        <Tile label="LAST HOUR" title="stars in the rolling last 60 minutes; the line is stars per hour over 24 h" sub="rolling 60 min" spark={<Spark values={sparks.hour} title="stars per hour, last 24 h" />}>
          <LiveNumber value={live.starsLastHour} locales="en-US" />
        </Tile>
        {/* the same today-vs-yesterday-at-this-hour reading as the console's
            status bar (LiveProvider.deltaPct), so the deck number has context */}
        <Tile label="TODAY UTC" title="stars since 00:00 UTC, compared with yesterday at the same hour; the line is the last 14 full days" sub={`yesterday now: ${fmt(live.yesterdaySameHour)}`} spark={<Spark values={sparks.day} title="stars per day, last 14 full days" />}>
          <LiveNumber value={live.todayCount} locales="en-US" />
          <Delta value={live.deltaPct} title="today so far vs yesterday at this hour" />
        </Tile>
        <Tile label="V7D" title="canonical 7-day velocity, stars per day; the % compares the last 7 full days with the 7 before" sub="stars/day, 7d" spark={<Spark values={sparks.v7} title="7-day average, last 30 days" />}>
          {fmt(live7)}
          <Delta value={weekPct} title="stars in the last 7 full days vs the 7 before" />
        </Tile>
        {/* no NEXT GATE tile: the Next gates panel's first row carries it,
            and a repeated number is noise, not emphasis */}
        {/* one NEIGHBORS tile instead of OVERTAKE + THREAT: both name the
            repo next to you, and six tiles split evenly in 6, 3x2 and 2x3.
            The value is the most urgent neighbour (a threat beats an
            overtake); the context line carries the other one. */}
        {(() => {
          const n = chase ?? nextOvertake;
          const overtakeSub = !n
            ? "no overtake in reach"
            : n.gap <= 0
              ? `${shortName(n.r)} passed`
              : `gap ${fmt(n.gap)} · ${
                  n.etaDays === null
                    ? "eta n/a"
                    : unsteadyLabel(n.unsteady)
                      ? `no firm eta · ${unsteadyLabel(n.unsteady)}`
                      : `eta ${etaText(n, n.etaDays)}`
                }`;
          if (threat) {
            const when = unsteadyLabel(threat.unsteady)
              ? `closing in · ${unsteadyLabel(threat.unsteady)}`
              : `catches you in ${etaText(threat, threat.catchDays)}`;
            const sub = `${when} · ${Math.round(threat.v)}/d`;
            return (
              <Tile
                label="THREAT"
                tone="warn"
                sub={sub}
                title={`${threat.r} · ${sub}${n ? ` · next overtake ${n.r} · ${overtakeSub}` : ""}`}
              >
                {shortName(threat.r)}
              </Tile>
            );
          }
          return (
            <Tile
              label={chase ? "CHASE" : "OVERTAKE"}
              tone={n ? "ink" : "dim"}
              sub={`${overtakeSub} · no threat`}
              title={n ? `${n.r} · ${overtakeSub} · no neighbor closing in` : "no neighbor in reach or closing in"}
            >
              {n ? shortName(n.r) : "—"}
            </Tile>
          );
        })()}
      </div>

      {/* body: the REAL console cards on a 12-column grid (globals.css
          .deck-body). Each cell is a fixed slot; charts take `fill` and grow
          to it, list panels scroll inside their own cell. */}
      {view === "health" ? (
        // half and half: PR flow shares the width with Vital Signs
        <div className="deck-view deck-view-half relative">
          <div className="deck-view-main">
            {/* on a short screen the panel scrolls inside itself; the frame never does */}
            <div className="deck-panel-scroll">
              <VitalSignsPanel repo={repo} name={repo.split("/")[1] ?? ""} reading={vitals} index="01" compact />
            </div>
          </div>
          <div className="deck-view-side">
            {/* PR flow leads the column; pulse closes it as the 30-day totals */}
            <div className="deck-panel-scroll deck-prflow">
              <PrFlowPanel flow={prFlow} index="02" />
            </div>
            <PulsePanel dossier={dossier} index="03" compact />
          </div>
        </div>
      ) : null}
      {view === "audience" ? (
        // Santiago (4-nov): the owner's two charts lead, tall; under them
        // Real usage (figures on top, then the console's acquisition chart)
        // beside the mission log, which scrolls in its own box
        <div className="deck-audience relative">
          <div className="deck-audience-top">
            <Panel index="01" title="Traffic vault" meta="private · kept past GitHub's 14-day window">
              <TrafficPanel repo={repo} compact />
            </Panel>
            <Panel index="02" title="Daily velocity rank" meta="by new stars each day">
              <GodVelocityRank repo={repo} compact />
            </Panel>
          </div>
          <UsagePanel dossier={dossier} index="03" compact withChart className="deck-usage-wide" />
          <Panel index="04" title="Mission log" meta={`${bundle.events.length} events · scroll`} className="deck-log deck-log-scroll">
            <MissionLog events={bundle.events} captain={bundle.captain} />
          </Panel>
        </div>
      ) : null}
      {/* kept mounted (inline display, which beats the unlayered .deck-body
          rule) so the race keeps its measured canvas across view switches */}
      <div
        className={`deck-body relative ${growthLayout === "ladder" ? "deck-body--ladder" : ""}`}
        style={view === "growth" ? undefined : { display: "none" }}
      >
        {/* the race gets the same header as every other card, so the most
            important cell is titled like one */}
        <section className="hud deck-hero relative flex flex-col overflow-hidden">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-grid px-4 py-2 sm:px-5">
            <div className="flex min-w-0 items-baseline gap-3">
              <span className="module-index shrink-0">01 /</span>
              <h2 className="module-title truncate">Star race</h2>
            </div>
            <span className="numeral hidden truncate text-label text-dim sm:block">
              destination: {bundle.apex ? `${shortName(bundle.apex.r)} · ${fmt(bundle.apex.s)} stars` : "the #1"}
            </span>
          </header>
          <div className="relative min-h-0 flex-1">
          <div ref={heroHole} className="absolute inset-0 flex items-center justify-center px-2">
            {canvas ? (
              <div className="w-full" style={{ maxWidth: canvas.maxPx }}>
                <GalacticChart inputs={inputs} target={target} onPinTarget={onPinTarget} fitW={canvas.fitW} deckPx={canvas.px} hideHelp shortBand={growthLayout === "ladder"} />
              </div>
            ) : null}
          </div>
          </div>
        </section>

        <Panel index="02" title="Next gates" meta={`v7d ${fmt(live7)}/d`} className="deck-proj deck-scroll">
          <Projections bundle={bundle} compact dense />
        </Panel>

        <Panel index="04" title="Stars / hour" meta="24h vs prev · UTC" className="deck-vel">
          <VelocityChart fill />
        </Panel>
        <Panel
          index="05"
          title="Daily ladder"
          // the zones' definition lives on the header's ⓘ, so the legend stays one line
          meta={
            <span title="thresholds = stars a day needed to rank top 10 / 50 / 100 / 250 by new stars among the 1,000 most-starred repos, monthly median">
              night floor 00-05 UTC · ⓘ thresholds
            </span>
          }
          className="deck-ladder"
        >
          <DailyLadder bundle={bundle} fill bands={ladderBands} />
        </Panel>
        <Panel index="06" title="World rank" meta="hourly" className="deck-rank">
          <RankChart bundle={bundle} fill />
        </Panel>

        <Panel index="03" title="Cumulative" meta={`since ${bundle.meta?.created_at?.slice(0, 10) ?? "launch"}`} className="deck-cum">
          <CurveChart repo={repo} fill />
        </Panel>
      </div>
      </div>
    </div>
  );
}
