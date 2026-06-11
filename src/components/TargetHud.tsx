"use client";

// Persistent chase HUD for the pinned target repo.
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import { fmt, fmtEtaDays, shortName } from "@/lib/format";

export default function TargetHud({
  bundle,
  target,
  onClear,
}: {
  bundle: DashboardBundle;
  target: string;
  onClear: () => void;
}) {
  const live = useLive();

  const liveN = live.neighbors.find((n) => n.r === target);
  const routeN = bundle.routeAll.find((p) => p.r === target);
  const s = liveN?.s ?? routeN?.s ?? null;
  const v = liveN?.v ?? null;

  if (s === null) {
    return (
      <div className="hud rise numeral flex items-center justify-between gap-3 border-warn/40 px-4 py-2 text-data">
        <span className="text-warn">target {shortName(target)} out of telemetry range</span>
        <button onClick={onClear} className="text-faint hover:text-ink" aria-label="Clear target">✕</button>
      </div>
    );
  }

  const gap = s - live.stars;
  const closing = v !== null ? Math.round((bundle.v7d - v) * 10) / 10 : null;
  const eta = gap > 0 && closing !== null && closing > 0 ? fmtEtaDays(gap / closing) : null;

  return (
    <div className="hud rise numeral flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-accent/30 px-4 py-2 text-data">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-display text-micro tracking-[0.3em] text-accent">CHASE TARGET</span>
        <span className="text-star">{target}</span>
        <span className="text-dim">{fmt(s)} ★</span>
        <span className={gap > 0 ? "text-ink" : "text-accent"}>
          {gap > 0 ? `gap +${fmt(gap)}` : "passed"}
        </span>
        {closing !== null && gap > 0 ? (
          <span className={closing > 0 ? "text-accent" : "text-warn"}>
            closing {closing >= 0 ? "+" : ""}{closing}/d
          </span>
        ) : null}
        {eta ? <span className="text-dim">eta {eta}</span> : null}
        {gap > 0 && closing !== null && closing <= 0 ? (
          <span className="text-warn">receding</span>
        ) : null}
        {v === null && gap > 0 ? <span className="text-faint">no velocity telemetry</span> : null}
      </div>
      <button onClick={onClear} className="text-faint transition-colors hover:text-ink" aria-label="Clear target">
        ✕
      </button>
    </div>
  );
}
