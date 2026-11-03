"use client";

// ETA to each milestone with a moving threshold: thresholds rise every day,
// so the effective chase speed is own v7d minus the threshold drift.
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import { fmt, fmtEtaDays, fmtEtaRange, etaDate } from "@/lib/format";
import { milestoneEta, pendingMilestones } from "@/lib/projections";

// `dense` (Command Deck): one row per gate, columns aligned, so four or five
// gates fit a short cell instead of the first two and a clipped third.
export default function Projections({
  bundle,
  compact,
  dense,
}: {
  bundle: DashboardBundle;
  compact?: boolean;
  dense?: boolean;
}) {
  const live = useLive();
  const vOwn = bundle.v7d;
  // only the gates still ahead: a crossed one sat here reading "crossed · gap 0"
  // above three real targets, which is the least useful row on the panel
  const ahead = pendingMilestones(bundle.milestones, live.stars);

  if (dense) {
    return (
      // deck-gates: globals.css hides the rows that would not fit whole in
      // the cell's height (container query), so a gate is shown entire or not
      <div className="deck-gates numeral flex h-full flex-col justify-between">
        {ahead.slice(0, 5).map((m) => {
          const e = milestoneEta(m.rank, m.threshold, live.stars, vOwn, m.drift);
          const pct = Math.min(100, (live.stars / m.threshold) * 100);
          const date = e.etaDays !== null ? etaDate(e.etaDays, new Date(live.nowMs)) : null;
          return (
            <div key={m.rank} className="border-b border-grid/60 pb-1 pt-0.5 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display text-sm tracking-[0.2em] text-ink">TOP {m.rank}</span>
                <span className="truncate text-sm text-accent">
                  {fmtEtaRange(e.etaDays, e.etaRange)}
                  {/* past a year the date is false precision: a dash keeps the column */}
                  <span className="ml-1.5 inline-block min-w-[3.25rem] text-right text-dim">
                    {date && e.gap > 0 && e.etaDays && e.etaDays <= 365 ? date : "—"}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-[2px] w-full bg-grid/60">
                <div className="h-full bg-accent/80" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 flex justify-between gap-3 text-micro leading-tight text-dim">
                <span className="truncate">gap {fmt(e.gap)} · ≥{fmt(m.threshold)}</span>
                <span className={`shrink-0 ${m.drift === null ? "text-warn/80" : ""}`}>
                  {m.drift === null ? "drift calibrating" : `+${fmt(Math.round(m.drift))}/d`}
                </span>
              </div>
            </div>
          );
        })}
        {!ahead.length ? (
          <span className="text-label text-dim">every gate on this route is behind you.</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {ahead.map((m) => {
        const e = milestoneEta(m.rank, m.threshold, live.stars, vOwn, m.drift);
        const pct = Math.min(100, (live.stars / m.threshold) * 100);
        const date = e.etaDays !== null ? etaDate(e.etaDays, new Date(live.nowMs)) : null;
        return (
          <div key={m.rank} className="border border-grid bg-hull/40 px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-data tracking-[0.25em] text-ink">
                TOP {m.rank}
              </span>
              <span className="numeral text-sm text-accent glow-accent">
                {fmtEtaRange(e.etaDays, e.etaRange)}
                {date && e.gap > 0 && e.etaDays && e.etaDays <= 365 ? <span className="ml-2 text-dim">{date}</span> : null}
              </span>
            </div>
            <div className="mt-2 h-[3px] w-full bg-grid/60">
              <div
                className="h-full bg-accent transition-[width] duration-700"
                style={{ width: `${pct}%`, opacity: 0.85 }}
              />
            </div>
            <div className="numeral mt-2 flex flex-wrap items-center justify-between gap-x-3 text-label text-dim">
              <span>
                threshold {fmt(m.threshold)} · gap {fmt(e.gap)}
              </span>
              <span className={m.drift === null ? "text-warn/80" : ""}>
                {m.drift === null
                  ? "drift calibrating"
                  : `drift +${fmt(Math.round(m.drift))}/day`}
              </span>
            </div>
          </div>
        );
      })}
      {!ahead.length ? (
        <div className="border border-grid bg-hull/40 px-4 py-3">
          <span className="numeral text-label text-dim">
            every gate on this route is behind you. the next one appears when the
            registry recomputes this repo's rank.
          </span>
        </div>
      ) : null}
      {!compact ? (
        <p className="numeral text-micro leading-relaxed text-faint">
          eta = gap / (own v7d - threshold drift). Thresholds are the star count
          of the repo holding each rank; they move up daily. Drift is measured
          from hourly history.
        </p>
      ) : null}
    </div>
  );
}
