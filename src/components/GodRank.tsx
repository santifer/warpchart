"use client";

// Owner-only unlock of the world-rank-over-time panel for ANY repo, the moat
// signal that is otherwise paywalled. Reads the private token from localStorage
// (set via /unlock?k=...), fetches the gated rank-history API, and renders the
// real trajectory in place of the locked teaser. Everything happens client-side
// so the public /r/ page keeps its ISR cache (no server-side cookie read). A
// visitor without the token just sees the normal locked preview (`locked`).
import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { usePalette } from "@/lib/usePalette";

type Pt = { t: number; rank: number; stars: number };
type State =
  | { kind: "locked" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "data"; pts: Pt[] };

export default function GodRank({ repo, locked }: { repo: string; locked: React.ReactNode }) {
  const C = usePalette();
  const [state, setState] = useState<State>({ kind: "locked" });

  useEffect(() => {
    const tok = typeof window !== "undefined" ? localStorage.getItem("wc_god") : null;
    if (!tok) {
      setState({ kind: "locked" });
      return;
    }
    setState({ kind: "loading" });
    let stop = false;
    fetch(`/api/v1/rank-history?repo=${encodeURIComponent(repo)}&k=${encodeURIComponent(tok)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { points?: Pt[] } | null) => {
        if (stop) return;
        // 403 / error -> behave exactly like a locked panel (no token leak)
        if (!d) return setState({ kind: "locked" });
        setState(d.points && d.points.length >= 2 ? { kind: "data", pts: d.points } : { kind: "empty" });
      })
      .catch(() => !stop && setState({ kind: "locked" }));
    return () => {
      stop = true;
    };
  }, [repo]);

  if (state.kind === "locked") return <>{locked}</>;

  if (state.kind === "loading") {
    return (
      <div className="flex h-[230px] items-center justify-center">
        <span className="numeral text-label tracking-[0.3em] text-dim">◌ DECRYPTING RANK HISTORY</span>
      </div>
    );
  }

  if (state.kind === "empty") {
    return (
      <div className="flex h-[230px] flex-col items-center justify-center gap-2 text-center">
        <span className="font-display text-label tracking-[0.3em] text-dim">NOT IN RECORDED TOP 10K</span>
        <span className="numeral text-label text-faint">no world-rank history for {repo}</span>
      </div>
    );
  }

  const data = state.pts.map((p) => ({ t: p.t, rank: p.rank, stars: p.stars }));
  const ranks = data.map((p) => p.rank);
  const yDomain: [number, number] = [Math.min(...ranks) - 2, Math.max(...ranks) + 2];
  const since = new Date(state.pts[0].t).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="relative flex h-[230px] w-full flex-col">
      <span className="numeral pointer-events-none absolute right-1 top-0 z-10 text-micro tracking-[0.24em] text-accent/70">
        ◈ GOD MODE
      </span>
      <div className="min-h-0 flex-1">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) =>
              new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            }
            tick={{ fill: C.faint, fontSize: 9 }}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            minTickGap={56}
          />
          <YAxis
            reversed
            domain={yDomain}
            allowDecimals={false}
            tickFormatter={(v: number) => `#${v}`}
            tick={{ fill: C.faint, fontSize: 9 }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: C.hull,
              border: `1px solid ${C.grid}`,
              borderRadius: 0,
              fontSize: 11,
              fontFamily: "var(--font-jbmono)",
            }}
            labelStyle={{ color: C.dim }}
            labelFormatter={(t) =>
              new Date(Number(t)).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            }
            formatter={(value, _n, item) => {
              const stars = (item as { payload?: { stars?: number } })?.payload?.stars;
              return [
                `#${value}${stars != null ? ` · ${stars.toLocaleString("en-US")} ★` : ""}`,
                "world rank",
              ];
            }}
          />
          <Line
            dataKey="rank"
            stroke={C.accent}
            strokeWidth={1.4}
            dot={false}
            type="stepAfter"
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      </div>
      <span className="numeral px-1 pt-1 text-micro text-faint">
        world rank · recorded live since {since} · the daily record, grows daily
      </span>
    </div>
  );
}
