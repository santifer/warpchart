"use client";

// COMMAND DECK: the star chart promoted to a fullscreen flight console.
// One screen, no scroll: a live telemetry strip on top, the pannable chart
// in the middle at the largest size the monitor allows, mission cards below.
// Uses the Fullscreen API when available and falls back to a fixed overlay
// (iOS Safari has no element fullscreen).
import { useEffect, useMemo, useRef, useState } from "react";
import NumberFlow from "@number-flow/react";
import GalacticChart from "./GalacticChart";
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import type { ChartInputs } from "@/lib/types";
import { fmt, fmtCompact, fmtEtaDays, shortName } from "@/lib/format";
import { neighborEtas } from "@/lib/projections";

function Metric({
  label,
  children,
  accent,
  big,
}: {
  label: string;
  children: React.ReactNode;
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

function DeckCard({
  label,
  main,
  hint,
  accent,
}: {
  label: string;
  main: React.ReactNode;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="hud px-4 py-2.5">
      <div className="module-title !text-micro">{label}</div>
      <div
        className={`numeral mt-1 truncate text-base leading-tight ${
          accent ? "text-accent" : "text-ink"
        }`}
      >
        {main}
      </div>
      {hint ? <div className="numeral mt-0.5 truncate text-label text-dim">{hint}</div> : null}
    </div>
  );
}

export default function CommandDeck({
  bundle,
  target,
  onPinTarget,
  onExit,
}: {
  bundle: DashboardBundle;
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

  // Measure the chart's real screen hole so the canvas width matches the
  // monitor's aspect: ultrawide screens get MORE MAP, not dead side bands.
  // With W = hole aspect x 740 the SVG fills both axes exactly; the only
  // overflow case is the clamp, capped via maxPx below.
  const chartHole = useRef<HTMLDivElement | null>(null);
  const [canvas, setCanvas] = useState<{ w: number; maxPx: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const r = chartHole.current?.getBoundingClientRect();
      if (!r || r.height < 120 || r.width < 320) return;
      const w = Math.min(Math.max(Math.round((r.width / r.height) * 740), 1200), 2600);
      setCanvas({ w, maxPx: Math.floor(r.height * (w / 740)) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
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
  const gates = bundle.milestones.slice(0, 3).map((m) => {
    const gap = Math.max(0, m.threshold - live.stars);
    const net = bundle.v7d - (m.drift ?? 0);
    return {
      rank: m.rank,
      threshold: m.threshold,
      gap,
      eta: gap === 0 ? "now" : net > 0 ? fmtEtaDays(gap / net) : "n/a",
    };
  });

  const etas = neighborEtas(live.neighbors, live.stars, bundle.v7d);
  const chase = target ? etas.find((n) => n.r === target) ?? null : null;
  const nextOvertake =
    etas
      .filter((n) => n.gap > 0 && !n.receding && n.etaDays !== null)
      .sort((a, b) => (a.etaDays ?? 1e9) - (b.etaDays ?? 1e9))[0] ?? null;
  // the most urgent number on the deck: who catches us first
  const threat =
    etas
      .filter((n) => n.gap <= 0 && n.catchDays !== null)
      .sort((a, b) => (a.catchDays ?? 1e9) - (b.catchDays ?? 1e9))[0] ?? null;

  return (
    <div
      ref={hostRef}
      className="fixed inset-0 z-50 flex flex-col gap-3 overflow-hidden bg-void px-4 py-3 sm:px-6 sm:py-4"
    >
      <div className="space-backdrop" />
      <div className="space-grid" />

      {/* telemetry strip */}
      <div className="hud relative flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5">
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
          <span className="font-display truncate text-sm uppercase tracking-[0.2em] text-star">
            {repo}
          </span>
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

      {/* the chart fills its real screen hole: the canvas width is derived
          from the measured aspect, so there are no dead side bands on wide
          monitors and no scaled-up pixels */}
      <div ref={chartHole} className="flex min-h-0 flex-1 items-center justify-center">
        {canvas ? (
          <div className="w-full" style={{ maxWidth: canvas.maxPx }}>
            <GalacticChart
              inputs={inputs}
              target={target}
              onPinTarget={onPinTarget}
              deck
              deckW={canvas.w}
            />
          </div>
        ) : null}
      </div>

      {/* mission cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {gates.map((g) => (
          <DeckCard
            key={g.rank}
            label={`TOP ${g.rank} GATE`}
            main={g.gap === 0 ? "crossed" : `${fmt(g.gap)} to go`}
            hint={`threshold ${fmt(g.threshold)} · eta ${g.eta}`}
            accent={g.gap === 0}
          />
        ))}
        {threat ? (
          <div className="hud px-4 py-2.5">
            <div className="module-title !text-micro">INBOUND THREAT</div>
            <div className="numeral mt-1 truncate text-base leading-tight text-warn">
              {shortName(threat.r)}
            </div>
            <div className="numeral mt-0.5 truncate text-label text-dim">
              catches you in {fmtEtaDays(threat.catchDays)} · {Math.round(threat.v)}/d
            </div>
          </div>
        ) : null}
        {chase ? (
          <DeckCard
            label="CHASE TARGET"
            accent
            main={shortName(chase.r)}
            hint={
              chase.gap <= 0
                ? "passed"
                : `gap ${fmt(chase.gap)} · eta ${
                    chase.etaDays !== null ? fmtEtaDays(chase.etaDays) : "n/a"
                  }`
            }
          />
        ) : nextOvertake ? (
          <DeckCard
            label="NEXT OVERTAKE"
            accent
            main={shortName(nextOvertake.r)}
            hint={`gap ${fmt(nextOvertake.gap)} · eta ${fmtEtaDays(nextOvertake.etaDays!)}`}
          />
        ) : null}
        {bundle.apex ? (
          <DeckCard
            label="GALACTIC CORE"
            main={shortName(bundle.apex.r)}
            hint={`${fmtCompact(bundle.apex.s)} ★ · ${fmtCompact(
              Math.max(0, bundle.apex.s - live.stars)
            )} ahead`}
          />
        ) : null}
      </div>
    </div>
  );
}
