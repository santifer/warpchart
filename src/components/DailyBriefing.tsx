"use client";

// Returning-visitor briefing: deltas since the last visit, stored client-side
// in localStorage. Shown only when the previous visit was more than 18h ago.
import { useEffect, useState } from "react";
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import { fmt, fmtEtaDays } from "@/lib/format";

const KEY = "mc_last_visit";
const MIN_GAP_H = 18;

interface Visit {
  ts: number;
  stars: number;
  rank: number | null;
}

export default function DailyBriefing({ bundle }: { bundle: DashboardBundle }) {
  const live = useLive();
  const [prev, setPrev] = useState<Visit | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const v = JSON.parse(raw) as Visit;
        if (Date.now() - v.ts > MIN_GAP_H * 3600_000) setPrev(v);
      }
      localStorage.setItem(
        KEY,
        JSON.stringify({ ts: Date.now(), stars: bundle.netStars, rank: bundle.rank })
      );
    } catch { /* private mode */ }
    // capture once on mount with build-time values; live deltas come below
  }, [bundle.netStars, bundle.rank]);

  if (!prev || dismissed) return null;

  const dStars = live.stars - prev.stars;
  const dRank = prev.rank !== null && live.rank !== null ? prev.rank - live.rank : null;
  const next = bundle.milestones.find((m) => m.threshold > live.stars) ?? null;
  let eta: string | null = null;
  if (next) {
    const net = bundle.v7d - (next.drift ?? 0);
    const gap = Math.max(0, next.threshold - live.stars);
    eta = net > 0 ? fmtEtaDays(gap / net) : null;
  }
  const hours = Math.round((Date.now() - prev.ts) / 3600_000);

  return (
    <div className="hud rise flex flex-wrap items-center justify-between gap-2 border-accent/30 px-4 py-2.5">
      <div className="numeral flex flex-wrap items-baseline gap-x-4 gap-y-1 text-data">
        <span className="font-display text-micro tracking-[0.3em] text-accent">
          MISSION BRIEFING
        </span>
        <span className="text-dim">
          since your last visit ({hours}h ago):
        </span>
        <span className="text-ink">
          {dStars >= 0 ? "+" : ""}{fmt(dStars)} stars
        </span>
        {dRank !== null && dRank !== 0 ? (
          <span className={dRank > 0 ? "text-accent" : "text-warn"}>
            rank {dRank > 0 ? "▲" : "▼"}{Math.abs(dRank)}
          </span>
        ) : null}
        {next && eta ? (
          <span className="text-dim">
            top {next.rank}: {eta}
          </span>
        ) : null}
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="numeral text-label text-faint transition-colors hover:text-ink"
        aria-label="Dismiss briefing"
      >
        ✕
      </button>
    </div>
  );
}
