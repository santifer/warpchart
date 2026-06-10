"use client";

// Stars per day (30 days): bars + 7-day moving average, plus the night-floor
// line (avg stars/hour between 00:00 and 04:59 UTC). A floor that keeps
// rising means compounding growth, not a spike decaying. Spike days carry an
// amber forensics marker with the identified cause (HN, Reddit, release).
import { useMemo } from "react";
import {
  ComposedChart, Bar, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
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
  spike: number | null;
  cause: string | null;
}

export default function DailyLadder({ bundle }: { bundle: DashboardBundle }) {
  const live = useLive();

  const data = useMemo<Row[]>(() => {
    const floorByDay = new Map(bundle.floor.map((f) => [f.d, f.perHour]));
    const causeByDay = new Map(
      bundle.spikes
        .filter((s) => s.causes.length)
        .map((s) => [s.date, s.causes[0].title])
    );
    const days = bundle.daily.slice(-30);
    const ma = bundle.ma7.slice(-30);
    const todayKey = new Date(live.nowMs).toISOString().slice(0, 10);
    return days.map((p, i) => {
      const stars = p.d === todayKey ? live.todayCount : p.c;
      const cause = causeByDay.get(p.d) ?? null;
      return {
        d: p.d,
        label: p.d.slice(5).replace("-", "/"),
        stars,
        ma7: ma[i],
        floor: floorByDay.get(p.d) ?? null,
        spike: cause ? stars : null,
        cause,
      };
    });
  }, [bundle.daily, bundle.ma7, bundle.floor, bundle.spikes, live.todayCount, live.nowMs]);

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
            formatter={(value, name, entry) => {
              if (name === "stars") return [`${value}`, "stars/day"];
              if (name === "ma7") return [`${value}`, "7d average"];
              if (name === "spike") {
                const cause = (entry?.payload as Row | undefined)?.cause;
                return [cause ?? "spike", "likely cause"];
              }
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
          <Scatter
            yAxisId="day" dataKey="spike" fill={C.warn} legendType="none"
            shape={(props: { cx?: number; cy?: number }) => (
              <path
                d={`M ${props.cx} ${(props.cy ?? 0) - 9} l 4 4 l -4 4 l -4 -4 Z`}
                fill={C.warn}
                opacity={0.95}
              />
            )}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
