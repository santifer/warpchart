"use client";

import NumberFlow from "@number-flow/react";
import { useLive } from "./LiveProvider";
import SoundToggle from "./SoundToggle";
import type { DashboardBundle } from "@/lib/bundle";
import { fmt, fmtEtaDays, timeAgo } from "@/lib/format";

function Metric({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 border-l border-grid pl-4 first:border-l-0 first:pl-0">
      <span className="module-title !text-[9px]">{label}</span>
      <span className="numeral text-xl leading-none text-ink sm:text-2xl">{children}</span>
      {hint ? <span className="numeral text-[10px] text-dim">{hint}</span> : null}
    </div>
  );
}

export default function StatusBar({ bundle }: { bundle: DashboardBundle }) {
  const live = useLive();
  const repo = bundle.meta?.repo ?? "unknown/unknown";
  const next = bundle.milestones[0] ?? null;

  let gap: number | null = null;
  let eta: string | null = null;
  if (next) {
    gap = Math.max(0, next.threshold - live.stars);
    const net = bundle.v7d - (next.drift ?? 0);
    eta = gap === 0 ? "now" : net > 0 ? fmtEtaDays(gap / net) : "n/a";
  }

  return (
    <header className="hud rise px-4 py-4 sm:px-6 sm:py-5" style={{ animationDelay: "0ms" }}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        {/* Identity */}
        <div className="flex items-center gap-4 min-w-0">
          {bundle.meta?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bundle.meta.avatar_url}
              alt={bundle.meta.owner}
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 border border-grid"
            />
          ) : null}
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="font-display text-sm tracking-[0.18em] text-star uppercase truncate">
                {repo}
              </h1>
              <span className="flex items-center gap-1.5 shrink-0">
                <span className={live.offline ? "h-[7px] w-[7px] rounded-full bg-warn" : "pulse-dot"} />
                <span className="numeral text-[9px] tracking-[0.2em] text-dim">
                  {live.offline ? "BUNDLED" : "LIVE"}
                </span>
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs font-light text-dim">
              {bundle.meta?.description ?? "growth telemetry"}
            </p>
          </div>
        </div>

        {/* Metrics strip */}
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3 sm:gap-x-6">
          <Metric label="Stars">
            <span className="glow-accent text-accent">
              <NumberFlow value={live.stars} locales="en-US" />
            </span>
          </Metric>
          <Metric label="World rank" hint={next ? `top ${next.rank} in ${eta}` : undefined}>
            {live.rank !== null ? (
              <>
                <span className="text-faint">#</span>
                <NumberFlow value={live.rank} locales="en-US" />
              </>
            ) : (
              "n/a"
            )}
          </Metric>
          <Metric label="Last 60 min" hint="stars/hour, sliding">
            <NumberFlow value={live.starsLastHour} locales="en-US" />
          </Metric>
          <Metric
            label="Today UTC"
            hint={`yesterday now: ${fmt(live.yesterdaySameHour)}`}
          >
            <NumberFlow value={live.todayCount} locales="en-US" />
            {live.deltaPct !== null ? (
              <span
                className={`ml-2 text-xs ${live.deltaPct >= 0 ? "text-accent" : "text-warn"}`}
              >
                {live.deltaPct >= 0 ? "+" : ""}
                {live.deltaPct}%
              </span>
            ) : null}
          </Metric>
          {next ? (
            <Metric label={`Gap to top ${next.rank}`} hint={`threshold ${fmt(next.threshold)}`}>
              {gap === 0 ? (
                <span className="text-accent">crossed</span>
              ) : (
                <NumberFlow value={gap ?? 0} locales="en-US" />
              )}
            </Metric>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-grid pt-2">
        <div className="flex items-center gap-5">
          <span className="numeral text-[9px] tracking-[0.15em] text-faint">
            MISSION CONTROL // GROWTH TELEMETRY
          </span>
          <SoundToggle />
        </div>
        <span className="numeral text-[9px] text-faint">
          {live.stale ? "STALE DATA · " : ""}
          sync {timeAgo(live.lastSync, live.nowMs)} · v7d {fmt(Math.round(bundle.v7d))}/day
        </span>
      </div>
    </header>
  );
}
