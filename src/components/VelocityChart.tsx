"use client";

// Stars per hour, last 24h as bars, with yesterday's same-hour curve as a
// ghost line. Built client-side from the merged timestamp window so the
// current hour updates live.
import { useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useLive } from "./LiveProvider";
import { usePalette } from "@/lib/usePalette";

const HOUR = 3600_000;

interface Row {
  t: number;
  label: string;
  now: number;
  prev: number;
}

export default function VelocityChart({ fill }: { fill?: boolean }) {
  const live = useLive();
  const C = usePalette();

  const data = useMemo<Row[]>(() => {
    const counts = new Map<number, number>();
    for (const iso of live.merged) {
      const h = Math.floor(Date.parse(iso) / HOUR) * HOUR;
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    const currentHour = Math.floor(live.nowMs / HOUR) * HOUR;
    const rows: Row[] = [];
    for (let i = 23; i >= 0; i--) {
      const t = currentHour - i * HOUR;
      rows.push({
        t,
        label: new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        now: counts.get(t) ?? 0,
        prev: counts.get(t - 24 * HOUR) ?? 0,
      });
    }
    return rows;
  }, [live.merged, live.nowMs]);

  return (
    <div className={fill ? "h-full min-h-0 w-full" : "h-[230px] w-full"}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: C.faint, fontSize: 9 }}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            interval={3}
          />
          <YAxis
            tick={{ fill: C.faint, fontSize: 9 }}
            tickLine={false}
            axisLine={false}
            width={46}
          />
          <Tooltip
            cursor={{ fill: C.accentSoft }}
            contentStyle={{
              background: C.hull, border: `1px solid ${C.grid}`, borderRadius: 0,
              fontSize: 11, fontFamily: "var(--font-jbmono)",
            }}
            labelStyle={{ color: C.dim }}
            formatter={(value, name) => [
              `${value} stars`,
              name === "now" ? "this 24h" : "previous 24h",
            ]}
          />
          <Bar dataKey="now" fill={C.accent} fillOpacity={0.75} maxBarSize={18} />
          <Line
            dataKey="prev"
            stroke={C.dim}
            strokeWidth={1}
            strokeDasharray="4 3"
            dot={false}
            type="monotone"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
