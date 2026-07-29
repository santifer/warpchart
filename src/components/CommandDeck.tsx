"use client";

// COMMAND DECK: the whole mission promoted to a fullscreen flight console.
// It does NOT reinvent any card: it REUSES the exact panels from the console
// (CumulativeChart, VelocityChart, DailyLadder, Heatmap, RankChart,
// Projections, PulsePanel, UsagePanel) and only relocates them, with the star
// race as a big hero on top and the eight telemetry cards in a grid below. A
// live KPI strip rides on top. The recharts cards take a `fill` prop so they
// grow to the cell; on desktop the deck fills the viewport with no scroll,
// below lg it stacks (hero first) and scrolls. Uses the Fullscreen API when
// available and falls back to a fixed overlay (iOS Safari has no element
// fullscreen).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import LiveNumber from "./LiveNumber";
import GalacticChart from "./GalacticChart";
import Panel from "./Panel";
import CurveChart from "./CurveChart";
import VelocityChart from "./VelocityChart";
import DailyLadder from "./DailyLadder";
import Heatmap from "./Heatmap";
import RankChart from "./RankChart";
import Projections from "./Projections";
import { PulsePanel, UsagePanel } from "./DossierPanels";
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import type { Dossier } from "@/lib/explorer";
import type { ChartInputs } from "@/lib/types";
import { fmt, fmtCompact, fmtEtaDays, fmtEtaRange, shortName } from "@/lib/format";
import { neighborEtas, milestoneEta } from "@/lib/projections";

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

// A named-by-repo urgent slot in the KPI strip (gate / overtake / threat).
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

  // Measure the hero hole so the chart canvas matches its aspect: wide cells
  // get MORE MAP, not scaled-up pixels.
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

  // KPI strip: the urgent dynamic numbers (next gate, next overtake, threat)
  const gates = bundle.milestones.map((m) => ({
    ...milestoneEta(m.rank, m.threshold, live.stars, vOwn, m.drift),
  }));
  const nextGate = gates.find((g) => g.gap > 0) ?? null;
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
            <LiveNumber value={live.stars} locales="en-US" />
          </Metric>
          <Metric label="WORLD RANK" big>
            {live.rank !== null ? (
              <>
                <span className="text-faint">#</span>
                <LiveNumber value={live.rank} locales="en-US" />
              </>
            ) : (
              "n/a"
            )}
          </Metric>
          <Metric label="LAST 60 MIN">
            <LiveNumber value={live.starsLastHour} locales="en-US" />
          </Metric>
          <Metric label="TODAY UTC">
            <LiveNumber value={live.todayCount} locales="en-US" />
          </Metric>
          <Metric label="V7D">{`${fmt(Math.round(bundle.v7d))}/d`}</Metric>
          {nextGate ? (
            <Pill
              label="NEXT GATE"
              tone="accent"
              name={`TOP ${nextGate.rank}`}
              sub={`${fmt(nextGate.gap)} to go · eta ${fmtEtaRange(nextGate.etaDays, nextGate.etaRange)}`}
            />
          ) : null}
          {chase ? (
            <Pill
              label="CHASE TARGET"
              tone="accent"
              name={shortName(chase.r)}
              sub={chase.gap <= 0 ? "passed" : `gap ${fmt(chase.gap)} · eta ${chase.etaDays !== null ? fmtEtaRange(chase.etaDays, chase.etaRange) : "n/a"}`}
            />
          ) : nextOvertake ? (
            <Pill
              label="NEXT OVERTAKE"
              tone="accent"
              name={shortName(nextOvertake.r)}
              sub={`gap ${fmt(nextOvertake.gap)} · eta ${fmtEtaRange(nextOvertake.etaDays!, nextOvertake.etaRange)}`}
            />
          ) : null}
          {threat ? (
            <Pill
              label="INBOUND THREAT"
              tone="warn"
              name={shortName(threat.r)}
              sub={`catches you in ${fmtEtaRange(threat.catchDays, threat.etaRange)} · ${Math.round(threat.v)}/d`}
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

      {/* body: the REAL console cards, relocated. the star race is a full-bleed
          hero whose box matches the chart aspect (so it fills the width with no
          side bands), and the eight telemetry cards keep their native readable
          size in the grid below. */}
      <div className="deck-body relative">
        <div className="deck-hero-wrap">
          <section className="hud relative overflow-hidden">
            <div ref={heroHole} className="absolute inset-0 flex items-center justify-center px-2">
              {canvas ? (
                <div className="w-full" style={{ maxWidth: canvas.maxPx }}>
                  <GalacticChart inputs={inputs} target={target} onPinTarget={onPinTarget} deck deckW={canvas.w} />
                </div>
              ) : null}
            </div>
            {bundle.apex ? (
              <span className="numeral pointer-events-none absolute right-3 top-2 z-10 text-micro text-faint">
                → core {shortName(bundle.apex.r)} · {fmtCompact(bundle.apex.s)} stars
              </span>
            ) : null}
          </section>
        </div>

        <div className="deck-grid">
          <Panel index="05" title="Velocity, stars per hour" meta="24h vs previous 24h">
            <VelocityChart />
          </Panel>
          <Panel index="02" title="Cumulative stars" meta={`since ${bundle.meta?.created_at?.slice(0, 10) ?? "launch"}`}>
            <CurveChart repo={repo} fill />
          </Panel>
          <Panel index="09" title="World rank over time" meta="hourly snapshots">
            <RankChart bundle={bundle} />
          </Panel>
          <Panel index="08" title="Activity heatmap" meta={`${fmt(bundle.totalStars)} star events`}>
            <Heatmap bundle={bundle} />
          </Panel>
          <PulsePanel dossier={dossier} index="03" />
          <UsagePanel dossier={dossier} index="04" />
          <Panel index="07" title="Daily ladder" meta="full history · night floor 00-05 UTC">
            <DailyLadder bundle={bundle} fill />
          </Panel>
          <Panel index="06" title="Milestone projections" meta={`own v7d ${fmt(Math.round(vOwn))}/day`}>
            <Projections bundle={bundle} compact />
          </Panel>
        </div>
      </div>
    </div>
  );
}
