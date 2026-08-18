"use client";

import LiveNumber from "./LiveNumber";
import { useLive } from "./LiveProvider";
import CodexModal from "./CodexModal";
import BadgeRow from "./BadgeRow";
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
      <span className="module-title !text-micro">{label}</span>
      <span className="numeral text-2xl leading-none text-ink sm:text-metric">{children}</span>
      {hint ? <span className="numeral text-label text-dim">{hint}</span> : null}
    </div>
  );
}

export default function StatusBar({ bundle }: { bundle: DashboardBundle }) {
  const live = useLive();
  const repo = bundle.meta?.repo ?? "unknown/unknown";
  // the NEXT gate, never one already cleared: the header's job is to point
  // forward. Uses live stars so it flips the instant the gate is passed.
  const next = bundle.milestones.find((m) => m.threshold > live.stars) ?? null;

  let gap: number | null = null;
  let eta: string | null = null;
  if (next) {
    gap = Math.max(0, next.threshold - live.stars);
    const net = bundle.v7d - (next.drift ?? 0);
    // gap is always > 0 now: `next` is by definition a gate not yet cleared
    eta = net > 0 ? fmtEtaDays(gap / net) : "n/a";
  }

  return (
    <header className="hud px-4 py-4 sm:px-6 sm:py-5">
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
              {/* phones: the full path doesn't fit next to the avatar, so it
                  wraps ONCE after the slash (never mid-name) instead of
                  truncating the most important datum on the page */}
              <h1 className="font-display min-w-0 text-sm tracking-[0.18em] text-star uppercase sm:truncate">
                <span className="whitespace-nowrap">{repo.split("/")[0]}/</span>
                <wbr />
                <span className="whitespace-nowrap">{repo.split("/")[1]}</span>
              </h1>
              <span
                className="flex items-center gap-1.5 shrink-0"
                title={
                  live.offline
                    ? "live feed unreachable · showing last known data"
                    : live.lastSync === null
                      ? "catching up with the live feed"
                      : "live · polls every 60s"
                }
              >
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
            <p className="mt-0.5 line-clamp-2 text-sm font-light text-dim sm:line-clamp-1">
              {bundle.meta?.description ?? "growth telemetry"}
            </p>
            <BadgeRow badges={bundle.badges} className="mt-2" />
            <div className="mt-2">
              <CodexModal
                repo={repo}
                stats={{ stars: live.stars, rank: live.rank, vPerDay: bundle.v7d }}
              />
            </div>
          </div>
        </div>

        {/* Metrics strip */}
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3 sm:gap-x-6">
          <Metric label="Stars">
            <span className="glow-accent text-accent">
              <LiveNumber value={live.stars} locales="en-US" />
            </span>
          </Metric>
          <Metric label="World rank" hint={next ? `top ${next.rank} in ${eta}` : undefined}>
            {live.rank !== null ? (
              <>
                <span className="text-faint">#</span>
                <LiveNumber value={live.rank} locales="en-US" />
              </>
            ) : (
              "n/a"
            )}
          </Metric>
          <Metric label="Last 60 min" hint="stars/hour, sliding">
            <LiveNumber value={live.starsLastHour} locales="en-US" />
          </Metric>
          <Metric
            label="Today UTC"
            hint={`yesterday now: ${fmt(live.yesterdaySameHour)}`}
          >
            <LiveNumber value={live.todayCount} locales="en-US" />
            {live.deltaPct !== null ? (
              <span
                className={`ml-2 text-sm ${live.deltaPct >= 0 ? "text-accent" : "text-warn"}`}
              >
                {live.deltaPct >= 0 ? "+" : ""}
                {live.deltaPct}%
              </span>
            ) : null}
          </Metric>
          {next ? (
            <Metric label={`Gap to top ${next.rank}`} hint={`threshold ${fmt(next.threshold)}`}>
              <LiveNumber value={gap ?? 0} locales="en-US" />
            </Metric>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-grid pt-2">
        <a
          href="/"
          className="numeral text-micro tracking-[0.15em] text-faint transition-colors hover:text-accent"
          title="Back to warpchart.dev"
        >
          WARPCHART // GROWTH TELEMETRY
        </a>
        <span className="numeral text-micro text-faint">
          {live.stale ? "STALE DATA · " : ""}
          {bundle.forkRatio !== null ? (
            <>
              fork ratio {(bundle.forkRatio * 100).toFixed(1)}%
              {bundle.forkPercentile !== null
                ? ` (higher than ${bundle.forkPercentile}% of the top 1000)`
                : ""}
              {" · "}
            </>
          ) : null}
          sync {timeAgo(live.lastSync, live.nowMs)} · v7d {fmt(Math.round(bundle.v7d))}/day
        </span>
      </div>
    </header>
  );
}
