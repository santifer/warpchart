"use client";

// Stars per day (30 days): bars + 7-day moving average, plus the night-floor
// line (avg stars/hour between 00:00 and 04:59 UTC). A floor that keeps
// rising means compounding growth, not a spike decaying.
import { useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import { C } from "@/lib/theme";

interface Row {
  d: string;
  label: string;
  stars: number;
  ma7: number | null;
  floor: number | null;
}

export default function DailyLadder({ bundle }: { bundle: DashboardBundle }) {
  const live = useLive();

  const data = useMemo<Row[]>(() => {
    const floorByDay = new Map(bundle.floor.map((f) => [f.d, f.perHour]));
    const days = bundle.daily.slice(-30);
    const ma = bundle.ma7.slice(-30);
    const todayKey = new Date(live.nowMs).toISOString().slice(0, 10);
    return days.map((p, i) => ({
      d: p.d,
      label: p.d.slice(5).replace("-", "/"),
      stars: p.d === todayKey ? live.todayCount : p.c,
      ma7: ma[i],
      floor: floorByDay.get(p.d) ?? null,
    }));
  }, [bundle.daily, bundle.ma7, bundle.floor, live.todayCount, live.nowMs]);

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 4, left: -14, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: C.faint, fontSize: 9 }}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            interval={4}
          />
          <YAxis
            yAxisId="day"
            tick={{ fill: C.faint, fontSize: 9 }}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <YAxis
            yAxisId="floor"
            orientation="right"
            tick={{ fill: C.warn, fontSize: 9, opacity: 0.7 }}
            tickLine={false}
            axisLine={false}
            width={34}
          />
          <Tooltip
            cursor={{ fill: C.accentSoft }}
            contentStyle={{
              background: C.hull, border: `1px solid ${C.grid}`, borderRadius: 0,
              fontSize: 11, fontFamily: "var(--font-jbmono)",
            }}
            labelStyle={{ color: C.dim }}
            formatter={(value, name) => {
              if (name === "stars") return [`${value}`, "stars/day"];
              if (name === "ma7") return [`${value}`, "7d average"];
              return [`${value}/h`, "night floor 00-05 UTC"];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-jbmono)", color: C.dim }}
            formatter={(v) =>
              v === "stars" ? "stars/day" : v === "ma7" ? "7d avg" : "night floor (/h)"
            }
          />
          <Bar yAxisId="day" dataKey="stars" fill={C.accent} fillOpacity={0.55} maxBarSize={16} />
          <Line
            yAxisId="day" dataKey="ma7" stroke={C.ink} strokeWidth={1.4}
            dot={false} type="monotone" connectNulls
          />
          <Line
            yAxisId="floor" dataKey="floor" stroke={C.warn} strokeWidth={1}
            strokeDasharray="5 3" dot={false} type="monotone" connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
