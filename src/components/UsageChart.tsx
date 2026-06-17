"use client";

// Real-usage curve for the dossier: the two ACQUISITION channels stacked and
// colour-coded over time — npm installs (cyan, since the package launched) and
// unique git clones (amber, since the Traffic Vault started recording, which
// GitHub itself deletes after 14 days). Each channel begins at its own real
// date, no fake backfill; where one has no data yet its layer is simply zero.
// CUMULATIVE tells the "watch it grow" story, DAILY shows the run-rate; the
// tooltip carries both channels. Clones are only passed for the public house
// repo (its vault is the opt-in demo); everyone else gets the npm series alone.
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

export default function UsageChart({
  npm,
  clones,
}: {
  npm: { day: string; d: number }[];
  clones?: { day: string; u: number }[] | null;
}) {
  const C = usePalette();
  const [mode, setMode] = useState<"cum" | "daily">("cum");

  const hasClones = !!clones && clones.length > 0;
  if ((!npm || npm.length < 2) && !hasClones) return null;

  // unify both channels on one daily timeline
  const byDay = new Map<string, { npm: number; clones: number }>();
  for (const p of npm ?? []) {
    const e = byDay.get(p.day) ?? { npm: 0, clones: 0 };
    e.npm += p.d;
    byDay.set(p.day, e);
  }
  for (const p of clones ?? []) {
    const e = byDay.get(p.day) ?? { npm: 0, clones: 0 };
    e.clones += p.u;
    byDay.set(p.day, e);
  }
  const days = [...byDay.keys()].sort();
  if (days.length < 2) return null;
  let cn = 0;
  let cc = 0;
  const rows = days.map((day) => {
    const e = byDay.get(day)!;
    cn += e.npm;
    cc += e.clones;
    return {
      t: Date.parse(`${day}T00:00:00Z`),
      npm: e.npm,
      clones: e.clones,
      npmCum: cn,
      clonesCum: cc,
    };
  });

  const firstNpm = (npm ?? []).find((p) => p.d > 0)?.day;
  const firstClone = hasClones ? clones![0]?.day : undefined;
  const fmtDay = (d?: string) =>
    d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="numeral text-micro tracking-[0.2em] text-faint">
          {hasClones ? "ACQUISITION OVER TIME" : "INSTALLS OVER TIME"}
        </span>
        <div className="flex gap-1">
          {(["cum", "daily"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`numeral border px-1.5 py-0.5 text-micro tracking-[0.16em] transition-colors ${
                mode === m ? "border-accent/50 text-accent" : "border-grid text-faint hover:text-dim"
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
              formatter={(value, name) => [fmt(Number(value)), name]}
            />
            {/* clones first = bottom of the stack (the bigger channel for a
                clone-and-run repo), npm on top */}
            {mode === "cum" ? (
              <>
                {hasClones ? (
                  <Area
                    type="monotone"
                    dataKey="clonesCum"
                    name="git clones · unique"
                    stackId="1"
                    stroke={C.warn}
                    strokeWidth={1.4}
                    fill={C.warn}
                    fillOpacity={0.16}
                    isAnimationActive
                    animationDuration={1200}
                    dot={false}
                  />
                ) : null}
                <Area
                  type="monotone"
                  dataKey="npmCum"
                  name="npm installs"
                  stackId="1"
                  stroke={C.accent}
                  strokeWidth={1.6}
                  fill={C.accentSoft}
                  isAnimationActive
                  animationDuration={1200}
                  dot={false}
                />
              </>
            ) : (
              <>
                {hasClones ? (
                  <Bar dataKey="clones" name="git clones · unique" stackId="1" fill={C.warn} fillOpacity={0.5} isAnimationActive animationDuration={900} />
                ) : null}
                <Bar dataKey="npm" name="npm installs" stackId="1" fill={C.accent} fillOpacity={0.6} isAnimationActive animationDuration={900} />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {hasClones ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: C.warn }} />
            <span className="numeral text-micro text-dim">git clones · unique · since {fmtDay(firstClone)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: C.accent }} />
            <span className="numeral text-micro text-dim">npm installs · since {fmtDay(firstNpm)}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
