"use client";

// COMMAND DECK: the whole mission promoted to a fullscreen flight console.
// One screen, no scroll on desktop: a live KPI strip on top, then a bento grid
// with the star race as the hero tile surrounded by COMPACT telemetry tiles
// (velocity, daily ladder, cumulative, world rank, heatmap, maintenance, usage,
// milestone gates). Tiles distil each dimension into a big number + sparkline
// for glanceability; the scrolling console below is where the deep charts live.
// Uses the Fullscreen API when available and falls back to a fixed overlay
// (iOS Safari has no element fullscreen). Below lg it stacks and scrolls: the
// no-scroll rule is sacrificed to keep the hierarchy (hero first).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import NumberFlow from "@number-flow/react";
import GalacticChart from "./GalacticChart";
import { useLive } from "./LiveProvider";
import { usePalette } from "@/lib/usePalette";
import type { DashboardBundle } from "@/lib/bundle";
import type { Dossier } from "@/lib/explorer";
import type { ChartInputs } from "@/lib/types";
import type { Palette, HeatStop } from "@/lib/theme";
import { fmt, fmtCompact, fmtEtaDays, shortName } from "@/lib/format";
import { neighborEtas, milestoneEta } from "@/lib/projections";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function downsample(arr: number[], maxPoints: number): number[] {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  const out = arr.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

function heatRamp(t: number, stops: HeatStop[]): string {
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].t) {
      const a = stops[i - 1];
      const b = stops[i];
      const k = (t - a.t) / (b.t - a.t);
      const mix = a.c.map((v, j) => Math.round(v + (b.c[j] - v) * k));
      return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
    }
  }
  const last = stops[stops.length - 1].c;
  return `rgb(${last[0]}, ${last[1]}, ${last[2]})`;
}

function ago(iso: string): string {
  const days = Math.max(0, (Date.now() - new Date(iso).getTime()) / DAY);
  if (days < 1) return "today";
  if (days < 60) return `${Math.round(days)}d ago`;
  if (days < 365) return `${Math.round(days / 30.44)}mo ago`;
  return `${(days / 365.25).toFixed(1)}y ago`;
}

// ── primitives ────────────────────────────────────────────────────────────

// Big glanceable number for the KPI strip.
function Metric({
  label,
  children,
  accent,
  big,
}: {
  label: string;
  children: ReactNode;
  accent?: boolean;
  big?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="module-title !text-micro">{label}</span>
      <span
        className={`numeral leading-none ${big ? "text-2xl" : "text-data"} ${
          accent ? "glow-accent text-accent" : "text-ink"
        }`}
      >
        {children}
      </span>
    </div>
  );
}

// A named-by-repo urgent slot in the KPI strip (overtake / threat / chase).
function Pill({
  label,
  name,
  sub,
  tone,
}: {
  label: string;
  name: string;
  sub: string;
  tone: "accent" | "warn";
}) {
  return (
    <div className="flex min-w-0 max-w-[170px] flex-col gap-0.5">
      <span className="module-title !text-micro">{label}</span>
      <span className={`numeral truncate text-data leading-none ${tone === "warn" ? "text-warn" : "text-accent"}`}>
        {name}
      </span>
      <span className="numeral truncate text-micro text-faint">{sub}</span>
    </div>
  );
}

// The bento tile frame: a hud box with a slim header and a fill body.
function Tile({
  area,
  label,
  meta,
  children,
}: {
  area: string;
  label: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`hud ${area} flex min-h-0 min-w-0 flex-col overflow-hidden`}>
      <header className="flex shrink-0 items-baseline justify-between gap-2 border-b border-grid px-3 py-1.5">
        <span className="module-title !text-micro truncate">{label}</span>
        {meta ? <span className="numeral shrink-0 text-micro text-faint truncate max-w-[55%]">{meta}</span> : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 py-2.5">{children}</div>
    </section>
  );
}

// A small stat inside a tile (maintenance / usage quads).
function Mini({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "accent" | "warn" | "ink";
}) {
  const c = tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent" : "text-ink";
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="numeral truncate text-micro tracking-[0.16em] text-faint">{label}</span>
      <span className={`numeral truncate text-data leading-none ${c}`}>{value}</span>
      {hint ? <span className="numeral truncate text-micro text-dim">{hint}</span> : null}
    </div>
  );
}

function Delta({ v, suffix }: { v: number | null; suffix?: string }) {
  if (v === null || v === 0) return <span className="numeral text-micro text-faint">—</span>;
  const up = v > 0;
  return (
    <span className={`numeral text-micro ${up ? "text-accent" : "text-warn"}`}>
      {up ? "▲" : "▼"} {fmt(Math.abs(v))}
      {suffix ?? ""}
    </span>
  );
}

// ── sparklines (fill their container; preserveAspectRatio none) ─────────────

function FillBars({ data, color, faint }: { data: number[]; color: string; faint: string }) {
  const n = data.length || 1;
  const max = Math.max(1, ...data);
  const bw = 100 / n;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      {data.map((v, i) => {
        const bh = (v / max) * 98;
        const last = i === n - 1;
        return (
          <rect
            key={i}
            x={i * bw + bw * 0.14}
            y={100 - bh}
            width={bw * 0.72}
            height={Math.max(0.8, bh)}
            fill={last ? color : faint}
            opacity={last ? 1 : 0.5}
          />
        );
      })}
    </svg>
  );
}

function FillArea({
  data,
  color,
  invert = false,
}: {
  data: number[];
  color: string;
  invert?: boolean;
}) {
  const n = data.length;
  if (n < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const X = (i: number) => (i / (n - 1)) * 100;
  const Y = (v: number) => {
    const f = (v - min) / span; // 0 = lowest value
    const fy = invert ? f : 1 - f; // invert: lowest value sits at the TOP (good for rank)
    return 2 + fy * 96;
  };
  const line = data.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(2)} ${Y(v).toFixed(2)}`).join(" ");
  const area = `${line} L100 100 L0 100 Z`;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <path d={area} fill={color} fillOpacity={0.13} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Self-sizing heatmap: 7 flex rows x 24 flex cells fill the tile exactly, so it
// stays a clean wide-short rectangle whatever height the grid hands it.
function DeckHeat({ bundle, C }: { bundle: DashboardBundle; C: Palette }) {
  const m = bundle.heatmap;
  const max = Math.max(1, ...m.flat());
  return (
    <div className="flex h-full w-full flex-col gap-[2px]">
      {m.map((row, d) => (
        <div key={d} className="flex min-h-0 flex-1 gap-[2px]">
          {row.map((c, h) => (
            <div
              key={h}
              className="min-w-0 flex-1"
              title={`${DAYS[d]} ${String(h).padStart(2, "0")}:00 UTC · ${fmt(c)} stars`}
              style={{ background: c === 0 ? C.heatZero : heatRamp(Math.pow(c / max, 0.75), C.heat) }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// A number + delta header line for a sparkline tile.
function TileHead({
  value,
  unit,
  delta,
}: {
  value: ReactNode;
  unit?: string;
  delta?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-baseline justify-between gap-2">
      <span className="numeral text-xl leading-none text-ink">
        {value}
        {unit ? <span className="ml-1 text-micro text-faint">{unit}</span> : null}
      </span>
      {delta ?? null}
    </div>
  );
}

function SparkBody({ children }: { children: ReactNode }) {
  return <div className="relative min-h-0 flex-1">{children}</div>;
}

export default function CommandDeck({
  bundle,
  dossier,
  target,
  onPinTarget,
  onExit,
}: {
  bundle: DashboardBundle;
  dossier: Dossier | null;
  target: string | null;
  onPinTarget: (r: string | null) => void;
  onExit: () => void;
}) {
  const live = useLive();
  const C = usePalette();
  const hostRef = useRef<HTMLDivElement | null>(null);

  const inputs = useMemo<ChartInputs>(
    () => ({
      repo: bundle.meta?.repo ?? "unknown/unknown",
      stars: live.stars,
      rank: live.rank,
      v7d: bundle.v7d,
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

  // Dedicated 1s clock: the shared live tick is 30s, too coarse for a deck.
  const [clockMs, setClockMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClockMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Measure the hero tile's real hole so the chart canvas matches its aspect:
  // wide cells get MORE MAP, not scaled-up pixels.
  const heroHole = useRef<HTMLDivElement | null>(null);
  const [canvas, setCanvas] = useState<{ w: number; maxPx: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const r = heroHole.current?.getBoundingClientRect();
      if (!r || r.height < 120 || r.width < 280) return;
      const w = Math.min(Math.max(Math.round((r.width / r.height) * 740), 1000), 2600);
      setCanvas({ w, maxPx: Math.floor(r.height * (w / 740)) });
    };
    measure();
    window.addEventListener("resize", measure);
    // fullscreen resize lands a beat after mount; re-measure to catch it
    const t = setTimeout(measure, 280);
    return () => {
      window.removeEventListener("resize", measure);
      clearTimeout(t);
    };
  }, []);

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

  // ── derived series for the compact tiles ──────────────────────────────────

  // velocity: 24h hourly bars vs the previous 24h total
  const vel = useMemo(() => {
    const counts = new Map<number, number>();
    for (const iso of live.merged) {
      const h = Math.floor(Date.parse(iso) / HOUR) * HOUR;
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    const cur = Math.floor(live.nowMs / HOUR) * HOUR;
    const now: number[] = [];
    let prevSum = 0;
    for (let i = 23; i >= 0; i--) {
      const t = cur - i * HOUR;
      now.push(counts.get(t) ?? 0);
      prevSum += counts.get(t - 24 * HOUR) ?? 0;
    }
    const nowSum = now.reduce((a, b) => a + b, 0);
    return { bars: now, nowSum, delta: nowSum - prevSum };
  }, [live.merged, live.nowMs]);

  // daily ladder: last 30 days, today live; delta vs the prior 7-day average
  const ladder = useMemo(() => {
    const todayKey = new Date(live.nowMs).toISOString().slice(0, 10);
    const last = bundle.daily.slice(-30);
    const bars = last.map((p) => (p.d === todayKey ? live.todayCount : p.c));
    const prior7 = bundle.daily.slice(-8, -1);
    const avg7 = prior7.length ? Math.round(prior7.reduce((a, b) => a + b.c, 0) / prior7.length) : 0;
    return { bars, today: live.todayCount, avg7, delta: live.todayCount - avg7 };
  }, [bundle.daily, live.todayCount, live.nowMs]);

  // cumulative: whole-life total curve
  const cum = useMemo(() => downsample(bundle.cumulative.map((p) => p.total), 64), [bundle.cumulative]);

  // rank over time + 7-day change
  const rankSeries = useMemo(() => {
    const pts = bundle.rankHistory.map((p) => p.rank);
    if (live.rank !== null) pts.push(live.rank);
    const weekAgo = bundle.rankHistory.find((p) => p.t >= live.nowMs - 7 * DAY);
    const delta = weekAgo && live.rank !== null ? weekAgo.rank - live.rank : null; // + = climbed
    return { pts, delta };
  }, [bundle.rankHistory, live.rank, live.nowMs]);

  // milestone gates
  const gates = bundle.milestones.slice(0, 4).map((m) => {
    const e = milestoneEta(m.rank, m.threshold, live.stars, vOwn, m.drift);
    return { ...e, pct: Math.min(100, (live.stars / m.threshold) * 100) };
  });

  // neighbours: the two most urgent numbers + an optional chase
  const etas = neighborEtas(live.neighbors, live.stars, vOwn);
  const chase = target ? etas.find((n) => n.r === target) ?? null : null;
  const nextOvertake =
    etas
      .filter((n) => n.gap > 0 && !n.receding && n.etaDays !== null)
      .sort((a, b) => (a.etaDays ?? 1e9) - (b.etaDays ?? 1e9))[0] ?? null;
  const threat =
    etas
      .filter((n) => n.gap <= 0 && n.catchDays !== null)
      .sort((a, b) => (a.catchDays ?? 1e9) - (b.catchDays ?? 1e9))[0] ?? null;
  const nextGate = gates.find((g) => g.gap > 0) ?? null;

  // maintenance / usage from the dossier
  const d = dossier;
  const netBacklog = d ? d.issuesOpened30 - d.issuesClosed30 : 0;
  const flowTotal = d ? d.issuesOpened30 + d.issuesClosed30 : 0;
  const closedShare = flowTotal > 0 ? (d!.issuesClosed30 / flowTotal) * 100 : 50;
  const lastRelease = d?.releases[0] ?? null;
  const releaseDays = lastRelease ? (Date.now() - new Date(lastRelease.at).getTime()) / DAY : null;
  const dlReleases = (d?.releases ?? []).filter((r) => r.downloads > 0).slice(0, 3);
  const maxDl = Math.max(1, ...dlReleases.map((r) => r.downloads));
  const hasUsage = Boolean(d && (d.npmLast30 !== null || dlReleases.length));

  return (
    <div
      ref={hostRef}
      className="fixed inset-0 z-50 flex flex-col gap-2.5 overflow-hidden bg-void px-3 py-2.5 sm:px-4 sm:py-3"
    >
      <div className="space-backdrop" />
      <div className="space-grid" />

      {/* KPI strip */}
      <div className="hud relative flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          {bundle.meta?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bundle.meta.avatar_url}
              alt=""
              width={30}
              height={30}
              className="h-[30px] w-[30px] border border-grid"
            />
          ) : null}
          <span className="font-display truncate text-sm uppercase tracking-[0.2em] text-star">{repo}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              className={
                live.offline
                  ? "h-[7px] w-[7px] rounded-full bg-warn"
                  : live.lastSync === null
                    ? "h-[7px] w-[7px] animate-pulse rounded-full bg-faint"
                    : "pulse-dot"
              }
            />
            <span className="numeral text-micro tracking-[0.2em] text-dim">
              {live.offline ? "SYNC LOST" : live.lastSync === null ? "SYNCING" : "LIVE"}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
          <Metric label="STARS" accent big>
            <NumberFlow value={live.stars} locales="en-US" />
          </Metric>
          <Metric label="WORLD RANK" big>
            {live.rank !== null ? (
              <>
                <span className="text-faint">#</span>
                <NumberFlow value={live.rank} locales="en-US" />
              </>
            ) : (
              "n/a"
            )}
          </Metric>
          <Metric label="LAST 60 MIN">
            <NumberFlow value={live.starsLastHour} locales="en-US" />
          </Metric>
          <Metric label="TODAY UTC">
            <NumberFlow value={live.todayCount} locales="en-US" />
          </Metric>
          <Metric label="V7D">{`${fmt(Math.round(bundle.v7d))}/d`}</Metric>
          {nextGate ? (
            <Pill
              label="NEXT GATE"
              tone="accent"
              name={`TOP ${nextGate.rank}`}
              sub={`${fmt(nextGate.gap)} to go · eta ${fmtEtaDays(nextGate.etaDays)}`}
            />
          ) : null}
          {chase ? (
            <Pill
              label="CHASE TARGET"
              tone="accent"
              name={shortName(chase.r)}
              sub={chase.gap <= 0 ? "passed" : `gap ${fmt(chase.gap)} · eta ${chase.etaDays !== null ? fmtEtaDays(chase.etaDays) : "n/a"}`}
            />
          ) : nextOvertake ? (
            <Pill
              label="NEXT OVERTAKE"
              tone="accent"
              name={shortName(nextOvertake.r)}
              sub={`gap ${fmt(nextOvertake.gap)} · eta ${fmtEtaDays(nextOvertake.etaDays!)}`}
            />
          ) : null}
          {threat ? (
            <Pill
              label="INBOUND THREAT"
              tone="warn"
              name={shortName(threat.r)}
              sub={`catches you in ${fmtEtaDays(threat.catchDays)} · ${Math.round(threat.v)}/d`}
            />
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          <span className="numeral text-sm text-dim" suppressHydrationWarning>
            {new Date(clockMs).toISOString().slice(11, 19)} UTC
          </span>
          <button
            onClick={exit}
            className="numeral border border-grid px-2.5 py-1 text-micro tracking-[0.2em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
          >
            ✕ EXIT DECK
          </button>
        </div>
      </div>

      {/* bento body: hero star race + compact telemetry tiles. DOM order is the
          mobile stack order; desktop placement comes from grid-template-areas. */}
      <div className="deck-body relative min-h-0 flex-1">
        {/* HERO: star race */}
        <section className="hud deck-hero flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header className="flex shrink-0 items-baseline justify-between gap-2 border-b border-grid px-3 py-1.5">
            <span className="module-title !text-micro truncate">Star race</span>
            {bundle.apex ? (
              <span className="numeral shrink-0 truncate text-micro text-faint">
                {`→ core ${shortName(bundle.apex.r)} · ${fmtCompact(bundle.apex.s)}★`}
              </span>
            ) : null}
          </header>
          <div ref={heroHole} className="flex min-h-0 flex-1 items-center justify-center px-2 py-2">
            {canvas ? (
              <div className="w-full" style={{ maxWidth: canvas.maxPx }}>
                <GalacticChart inputs={inputs} target={target} onPinTarget={onPinTarget} deck deckW={canvas.w} />
              </div>
            ) : null}
          </div>
        </section>

        {/* VELOCITY */}
        <Tile area="deck-vel" label="Velocity · 24h" meta="vs prev 24h">
          <TileHead value={fmt(vel.nowSum)} unit="stars/24h" delta={<Delta v={vel.delta} />} />
          <SparkBody>
            <FillBars data={vel.bars} color={C.accent} faint={C.faint} />
          </SparkBody>
        </Tile>

        {/* DAILY LADDER */}
        <Tile area="deck-ladder" label="Daily ladder" meta="30d">
          <TileHead value={fmt(ladder.today)} unit="today" delta={<Delta v={ladder.delta} />} />
          <SparkBody>
            <FillBars data={ladder.bars} color={C.accent} faint={C.faint} />
          </SparkBody>
          <span className="numeral shrink-0 text-micro text-faint">7d avg {fmt(ladder.avg7)}/day</span>
        </Tile>

        {/* CUMULATIVE */}
        <Tile area="deck-cum" label="Cumulative stars" meta={bundle.meta?.created_at ? `since ${bundle.meta.created_at.slice(0, 10)}` : undefined}>
          <TileHead value={fmtCompact(live.stars)} unit="total ★" />
          <SparkBody>
            <FillArea data={cum} color={C.accent} />
          </SparkBody>
        </Tile>

        {/* WORLD RANK */}
        <Tile area="deck-rank" label="World rank" meta="hourly · 7d Δ">
          <TileHead
            value={live.rank !== null ? <><span className="text-faint">#</span>{fmt(live.rank)}</> : "n/a"}
            delta={<Delta v={rankSeries.delta} suffix=" ranks" />}
          />
          <SparkBody>
            {rankSeries.pts.length >= 2 ? (
              <FillArea data={rankSeries.pts} color={C.accent} invert />
            ) : (
              <div className="numeral flex h-full items-center justify-center text-micro tracking-[0.2em] text-faint">
                ACCUMULATING HISTORY
              </div>
            )}
          </SparkBody>
        </Tile>

        {/* HEATMAP */}
        <Tile area="deck-heat" label="Activity heatmap" meta="hour × weekday · UTC">
          <DeckHeat bundle={bundle} C={C} />
        </Tile>

        {/* MAINTENANCE */}
        <Tile area="deck-maint" label="Maintenance pulse" meta="30d">
          {d ? (
            <div className="flex h-full flex-col justify-between gap-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <Mini label="COMMITS" value={d.commits30 !== null ? fmtCompact(d.commits30) : "—"} hint="default branch" />
                <Mini label="ISSUE FLOW" value={`${fmtCompact(d.issuesOpened30)} in`} hint={`${fmtCompact(d.issuesClosed30)} resolved`} />
                <Mini label="PRS MERGED" value={fmtCompact(d.prsMerged30)} hint="pull requests" />
                <Mini
                  label="LAST RELEASE"
                  value={lastRelease ? ago(lastRelease.at) : "—"}
                  hint={lastRelease ? lastRelease.tag : "no releases"}
                  tone={releaseDays !== null && releaseDays > 120 ? "warn" : "accent"}
                />
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <div className="h-1.5 w-full overflow-hidden bg-grid/60">
                  <div className="h-full bg-accent/70" style={{ width: `${closedShare.toFixed(1)}%` }} />
                </div>
                <div className="numeral flex justify-between text-micro text-faint">
                  <span>
                    backlog {netBacklog > 0 ? "+" : ""}
                    {fmtCompact(netBacklog)}{" "}
                    <span className={netBacklog > 0 ? "text-warn" : "text-accent"}>{netBacklog > 0 ? "▲" : "▼"}</span>
                  </span>
                  <span>{fmtCompact(d.openIssues)} open</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="numeral flex h-full items-center justify-center text-center text-micro tracking-[0.2em] text-faint">
              PULSE TELEMETRY UNAVAILABLE
            </div>
          )}
        </Tile>

        {/* USAGE */}
        <Tile area="deck-usage" label="Real usage" meta="installs, not applause">
          {hasUsage ? (
            <div className="flex h-full flex-col gap-2.5">
              {d!.npmLast30 !== null ? (
                <Mini label="NPM INSTALLS · 30D" value={fmtCompact(d!.npmLast30)} hint={d!.npmPkg ?? undefined} tone="accent" />
              ) : null}
              {dlReleases.length ? (
                <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                  <span className="numeral text-micro tracking-[0.16em] text-faint">RELEASE DOWNLOADS</span>
                  {dlReleases.map((r) => (
                    <div key={r.tag} className="flex items-center gap-2">
                      <span className="numeral w-20 shrink-0 truncate text-micro text-dim">{r.tag}</span>
                      <div className="h-1.5 flex-1 overflow-hidden bg-grid/60">
                        <div className="h-full bg-accent/70" style={{ width: `${((r.downloads / maxDl) * 100).toFixed(1)}%` }} />
                      </div>
                      <span className="numeral w-12 shrink-0 text-right text-micro text-ink">{fmtCompact(r.downloads)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="numeral flex h-full items-center justify-center text-center text-micro tracking-[0.2em] text-faint">
              NO PUBLIC DISTRIBUTION ARTIFACTS
            </div>
          )}
        </Tile>

        {/* MILESTONE GATES */}
        <Tile area="deck-gates" label="Milestone gates" meta={`v7d ${fmt(Math.round(vOwn))}/d`}>
          <div className="flex h-full flex-col justify-center gap-2.5">
            {gates.map((g) => (
              <div key={g.rank} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-micro tracking-[0.2em] text-ink">TOP {g.rank}</span>
                  <span className="numeral text-micro text-accent glow-accent">
                    {g.gap === 0 ? "crossed" : fmtEtaDays(g.etaDays)}
                  </span>
                </div>
                <div className="h-[3px] w-full bg-grid/60">
                  <div className="h-full bg-accent" style={{ width: `${g.pct}%`, opacity: 0.85 }} />
                </div>
                <div className="numeral flex justify-between text-micro text-faint">
                  <span>{g.gap === 0 ? `threshold ${fmt(g.threshold)}` : `${fmt(g.gap)} to go`}</span>
                  <span>{g.drift === null ? "drift calibrating" : `drift +${fmt(Math.round(g.drift))}/d`}</span>
                </div>
              </div>
            ))}
          </div>
        </Tile>
      </div>
    </div>
  );
}
