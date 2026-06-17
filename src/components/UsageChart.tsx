"use client";

// The npm install curve for the Real Usage panel: watch installs accumulate
// since launch (the usage-growth signal that actually counts), with real axes
// (X = date, Y = installs) and a hover tooltip carrying BOTH the running total
// and that day's installs. A CUMULATIVE / DAILY toggle covers both readings:
// cumulative tells the "watch it grow" story, daily shows the run-rate trend.
import { useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { usePalette } from "@/lib/usePalette";
import { fmt, fmtCompact } from "@/lib/format";

export default function UsageChart({ history }: { history: { day: string; d: number }[] }) {
  const C = usePalette();
  const [mode, setMode] = useState<"cum" | "daily">("cum");
  if (!history || history.length < 2) return null;

  let acc = 0;
  const rows = history.map((p) => {
    acc += p.d;
    return { t: Date.parse(`${p.day}T00:00:00Z`), cum: acc, daily: p.d };
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="numeral text-micro tracking-[0.2em] text-faint">INSTALLS OVER TIME</span>
        <div className="flex gap-1">
          {(["cum", "daily"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`numeral border px-1.5 py-0.5 text-micro tracking-[0.16em] transition-colors ${
                mode === m
                  ? "border-accent/50 text-accent"
                  : "border-grid text-faint hover:text-dim"
              }`}
            >
              {m === "cum" ? "CUMULATIVE" : "DAILY"}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[120px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 26, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) =>
                new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              }
              tick={{ fill: C.dim, fontSize: 11, fontFamily: "var(--font-jbmono)" }}
              tickLine={false}
              axisLine={{ stroke: C.grid }}
              minTickGap={44}
              padding={{ left: 6, right: 8 }}
            />
            <YAxis
              tickFormatter={(v: number) => fmtCompact(v)}
              tick={{ fill: C.dim, fontSize: 11, fontFamily: "var(--font-jbmono)" }}
              tickLine={false}
              axisLine={false}
              width={42}
            />
            <Tooltip
              contentStyle={{
                background: C.hull,
                border: `1px solid ${C.grid}`,
                fontFamily: "var(--font-jbmono)",
                fontSize: 12,
              }}
              labelStyle={{ color: C.dim }}
              labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("en-US", { dateStyle: "medium" })}
              formatter={(value, name, item) => {
                const p = (item as { payload?: { cum?: number; daily?: number } }).payload ?? {};
                return [`${fmt(p.cum ?? 0)} total · +${fmt(p.daily ?? 0)} that day`, "npm installs"];
              }}
            />
            {mode === "cum" ? (
              <Area
                type="monotone"
                dataKey="cum"
                stroke={C.accent}
                strokeWidth={1.6}
                fill={C.accentSoft}
                isAnimationActive
                animationDuration={1200}
                dot={false}
              />
            ) : (
              <Bar dataKey="daily" fill={C.accent} fillOpacity={0.5} isAnimationActive animationDuration={900} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
