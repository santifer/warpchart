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
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import type { LadderBand } from "@/lib/ladder-bands";
import type { Dossier } from "@/lib/explorer";
import type { ChartInputs } from "@/lib/types";
import { fmt, fmtEtaRange, shortName } from "@/lib/format";
import { neighborEtas, milestoneEta, unsteadyLabel, etaText } from "@/lib/projections";

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
}: {
  label: string;
  children: ReactNode;
  sub?: ReactNode;
  tone?: "ink" | "accent" | "warn" | "dim";
  big?: boolean;
  title?: string;
}) {
  const color =
    tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : tone === "dim" ? "text-faint" : "text-ink";
  return (
    <div className="deck-tile flex min-w-0 flex-col gap-1 px-3 py-2 sm:px-3.5" title={title}>
      <span className="module-title !text-micro truncate">{label}</span>
      {/* fixed-height value line, bottom-aligned: big and normal values share
          one baseline across the strip */}
      <span className="flex h-8 items-end">
        <span
          className={`numeral truncate leading-none ${big ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl"} ${color} ${
            big && tone === "accent" ? "glow-accent" : ""
          }`}
        >
          {children}
        </span>
      </span>
      {/* phones have no hover tooltip: the context line may wrap to two lines
          there instead of being cut; from sm up it is one line, full text in title */}
      <span className="numeral line-clamp-2 text-micro text-faint sm:line-clamp-none sm:truncate">
        {sub ?? "\u00a0"}
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
}: {
  bundle: DashboardBundle;
  dossier: Dossier | null;
  target: string | null;
  onPinTarget: (r: string | null) => void;
  onExit: () => void;
  ladderBands?: LadderBand[] | null;
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
  const [canvas, setCanvas] = useState<{ w: number; maxPx: number } | null>(null);
  useEffect(() => {
    const el = heroHole.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.height < 120 || r.width < 280) return;
      const w = Math.min(Math.max(Math.round((r.width / r.height) * 740), 1000), 2600);
      const next = { w, maxPx: Math.floor(r.height * (w / 740)) };
      setCanvas((c) => (c && c.w === next.w && c.maxPx === next.maxPx ? c : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
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

  // KPI strip: the urgent dynamic numbers (next gate, next overtake, threat)
  const gates = bundle.milestones.map((m) => ({
    ...milestoneEta(m.rank, m.threshold, live.stars, vOwn, m.drift),
  }));
  const nextGate = gates.find((g) => g.gap > 0) ?? null;
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

  const live7 = Math.round(bundle.v7d);
  const syncLabel = live.offline ? "SYNC LOST" : live.lastSync === null ? "SYNCING" : "LIVE";

  return (
    <div
      ref={hostRef}
      className="fixed inset-0 z-50 flex flex-col gap-2 overflow-hidden bg-void px-3 py-2.5 sm:px-4 sm:py-3"
    >
      <div className="space-backdrop" />
      <div className="space-grid" />

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
        <Tile label="STARS" tone="accent" big sub={`since ${bundle.meta?.created_at?.slice(0, 10) ?? "launch"}`}>
          <LiveNumber value={live.stars} locales="en-US" />
        </Tile>
        <Tile label="RANK" big sub="worldwide">
          {live.rank !== null ? (
            <>
              <span className="text-faint">#</span>
              <LiveNumber value={live.rank} locales="en-US" />
            </>
          ) : (
            "n/a"
          )}
        </Tile>
        <Tile label="LAST HOUR" sub="rolling 60 min">
          <LiveNumber value={live.starsLastHour} locales="en-US" />
        </Tile>
        {/* the same today-vs-yesterday-at-this-hour reading as the console's
            status bar (LiveProvider.deltaPct), so the deck number has context */}
        <Tile label="TODAY UTC" sub={`yesterday now: ${fmt(live.yesterdaySameHour)}`}>
          <LiveNumber value={live.todayCount} locales="en-US" />
          {live.deltaPct !== null ? (
            <span className={`ml-2 text-sm ${live.deltaPct >= 0 ? "text-accent" : "text-warn"}`}>
              {live.deltaPct >= 0 ? "+" : ""}
              {live.deltaPct}%
            </span>
          ) : null}
        </Tile>
        <Tile label="V7D" sub="stars/day, 7d">
          {fmt(live7)}
        </Tile>
        {nextGate ? (
          <Tile
            label="NEXT GATE"
            tone="accent"
            sub={`${fmt(nextGate.gap)} to go · eta ${fmtEtaRange(nextGate.etaDays, nextGate.etaRange)}`}
            title={`${fmt(nextGate.gap)} to go · eta ${fmtEtaRange(nextGate.etaDays, nextGate.etaRange)}`}
          >
            TOP {nextGate.rank}
          </Tile>
        ) : (
          <Tile label="NEXT GATE" tone="dim" sub="every gate passed">
            —
          </Tile>
        )}
        {(() => {
          const n = chase ?? nextOvertake;
          if (!n)
            return (
              <Tile label="OVERTAKE" tone="dim" sub="no neighbor in reach">
                —
              </Tile>
            );
          const sub =
            n.gap <= 0
              ? "passed"
              : `gap ${fmt(n.gap)} · ${
                  n.etaDays === null
                    ? "eta n/a"
                    : unsteadyLabel(n.unsteady)
                      ? `no firm eta · ${unsteadyLabel(n.unsteady)}`
                      : `eta ${etaText(n, n.etaDays)}`
                }`;
          return (
            <Tile label={chase ? "CHASE" : "OVERTAKE"} tone="accent" sub={sub} title={`${n.r} · ${sub}`}>
              {shortName(n.r)}
            </Tile>
          );
        })()}
        {threat ? (
          (() => {
            const sub = `${
              unsteadyLabel(threat.unsteady)
                ? `closing in · ${unsteadyLabel(threat.unsteady)}`
                : `catches you in ${etaText(threat, threat.catchDays)}`
            } · ${Math.round(threat.v)}/d`;
            return (
              <Tile label="THREAT" tone="warn" sub={sub} title={`${threat.r} · ${sub}`}>
                {shortName(threat.r)}
              </Tile>
            );
          })()
        ) : (
          <Tile label="THREAT" tone="dim" sub="no neighbor closing in">
            clear
          </Tile>
        )}
      </div>

      {/* body: the REAL console cards on a 12-column grid (globals.css
          .deck-body). Each cell is a fixed slot; charts take `fill` and grow
          to it, list panels scroll inside their own cell. */}
      <div className="deck-body relative">
        <section className="hud deck-hero relative overflow-hidden">
          <div ref={heroHole} className="absolute inset-0 flex items-center justify-center px-2">
            {canvas ? (
              <div className="w-full" style={{ maxWidth: canvas.maxPx }}>
                <GalacticChart inputs={inputs} target={target} onPinTarget={onPinTarget} deck deckW={canvas.w} />
              </div>
            ) : null}
          </div>
        </section>

        <Panel index="06" title="Next gates" meta={`v7d ${fmt(live7)}/d`} className="deck-proj deck-scroll">
          <Projections bundle={bundle} compact />
        </Panel>

        <Panel index="05" title="Stars / hour" meta="24h vs prev" className="deck-vel">
          <VelocityChart fill />
        </Panel>
        <Panel index="07" title="Daily ladder" meta="night floor 00-05 UTC" className="deck-ladder">
          <DailyLadder bundle={bundle} fill bands={ladderBands} />
        </Panel>
        <Panel index="09" title="World rank" meta="hourly" className="deck-rank">
          <RankChart bundle={bundle} fill />
        </Panel>

        <Panel index="02" title="Cumulative" meta={`since ${bundle.meta?.created_at?.slice(0, 10) ?? "launch"}`} className="deck-cum">
          <CurveChart repo={repo} fill />
        </Panel>
        <PulsePanel dossier={dossier} index="03" className="deck-pulse deck-scroll" />
        <UsagePanel dossier={dossier} index="04" className="deck-usage deck-scroll" />
      </div>
    </div>
  );
}
