"use client";

// Worldwide rank over time, from hourly snapshots. Y axis reversed: up means
// climbing. Grows richer as history accumulates.
import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import { usePalette } from "@/lib/usePalette";

export default function RankChart({ bundle }: { bundle: DashboardBundle }) {
  const live = useLive();
  const C = usePalette();

  const data = useMemo(() => {
    const base = bundle.rankHistory.map((p) => ({ t: p.t, rank: p.rank }));
    if (live.rank !== null) base.push({ t: live.nowMs, rank: live.rank });
    return base;
  }, [bundle.rankHistory, live.rank, live.nowMs]);

  if (data.length < 5) {
    return (
      <div className="flex h-[230px] flex-col items-center justify-center gap-2">
        <span className="font-display text-[10px] tracking-[0.3em] text-dim">
          ACCUMULATING HISTORY
        </span>
        <span className="numeral text-[10px] text-faint">
          {data.length} snapshot{data.length === 1 ? "" : "s"} · one per hour from now on
        </span>
      </div>
    );
  }

  return (
    <div className="h-[230px] w-full">
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
            domain={["dataMin - 2", "dataMax + 2"]}
            allowDecimals={false}
            tickFormatter={(v: number) => `#${v}`}
            tick={{ fill: C.faint, fontSize: 9 }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: C.hull, border: `1px solid ${C.grid}`, borderRadius: 0,
              fontSize: 11, fontFamily: "var(--font-jbmono)",
            }}
            labelStyle={{ color: C.dim }}
            labelFormatter={(t) =>
              new Date(Number(t)).toLocaleString("en-US", {
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              })
            }
            formatter={(value) => [`#${value}`, "world rank"]}
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
  );
}
