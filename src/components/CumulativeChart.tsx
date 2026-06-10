"use client";

// Total stars over the whole mission. Y axis pinned from 0 to the current
// total, X axis is time. The honest chart: no zoom tricks.
import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import { C } from "@/lib/theme";
import { fmtCompact, fmt } from "@/lib/format";

export default function CumulativeChart({ bundle }: { bundle: DashboardBundle }) {
  const live = useLive();

  const data = useMemo(() => {
    const base = bundle.cumulative.map((p) => ({ t: p.t, total: p.total }));
    // Extend the curve to "now" with the live gross total.
    const grossNow = bundle.totalStars + (live.merged.length - bundle.recent48h.length);
    base.push({ t: live.nowMs, total: grossNow });
    return base;
  }, [bundle.cumulative, bundle.totalStars, bundle.recent48h.length, live.merged.length, live.nowMs]);

  const yMax = data[data.length - 1]?.total ?? 1;

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 4, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.accent} stopOpacity={0.32} />
              <stop offset="100%" stopColor={C.accent} stopOpacity={0.02} />
            </linearGradient>
          </defs>
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
            minTickGap={48}
          />
          <YAxis
            domain={[0, yMax]}
            tickFormatter={(v: number) => fmtCompact(v)}
            tick={{ fill: C.faint, fontSize: 9 }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            contentStyle={{
              background: C.hull, border: `1px solid ${C.grid}`, borderRadius: 0,
              fontSize: 11, fontFamily: "var(--font-jbmono)",
            }}
            labelStyle={{ color: C.dim }}
            labelFormatter={(t) =>
              new Date(Number(t)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            }
            formatter={(value) => [fmt(Number(value)), "stars"]}
          />
          <Area
            dataKey="total"
            stroke={C.accent}
            strokeWidth={1.4}
            fill="url(#cumFill)"
            dot={false}
            type="monotone"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
