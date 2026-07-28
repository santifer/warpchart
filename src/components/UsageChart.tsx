"use client";

// Real-usage curve for the dossier: the acquisition channels STACKED over time
// so the top of the stack is the TOTAL — npm installs (cyan) at the base, unique
// git clones (amber) on top, and a white line tracing the running total. Each
// channel starts at its own real date (npm at launch, clones when the Traffic
// Vault began recording — GitHub deletes clones after 14 days), no fake
// backfill; a newer source simply lifts off zero on its first day. The tooltip
// breaks the point down into total + each channel. CUMULATIVE tells the
// watch-it-grow story; DAILY shows the run-rate. Clones are only passed for the
// public house repo (its vault is the opt-in demo); others get npm alone.
import { useState, type ComponentProps } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { usePalette } from "@/lib/usePalette";
import { fmt, fmtCompact } from "@/lib/format";

interface Row {
  t: number;
  // null past a channel's last published day: unknown, not zero. Recharts
  // breaks the line there instead of drawing a drop to the axis.
  npm: number | null;
  clones: number | null;
  npmCum: number;
  clonesCum: number;
  total: number;
  totalCum: number;
}

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
  // npm channel is only real when it has non-zero days; otherwise (npm outage or
  // a clone-only repo) suppress it so we never draw a flat-zero npm series or an
  // empty "since" date on a panel titled "installs, not applause".
  const hasNpm = (npm ?? []).some((p) => p.d > 0);
  if ((!npm || npm.length < 2) && !hasClones) return null;

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
  // Channels publish at different speeds: npm's daily series lands 3-4 days
  // after GitHub's traffic API. Past a channel's last real day the value is
  // UNKNOWN, not zero - drawing it as zero made npm look like it collapsed.
  const lastNpmDay = (npm ?? []).reduce<string | null>((m, p) => (!m || p.day > m ? p.day : m), null);
  const lastCloneDay = (clones ?? []).reduce<string | null>((m, p) => (!m || p.day > m ? p.day : m), null);
  // The CURVE stops on the last day every active channel has closed, so it
  // keeps a clean common horizon instead of a stretch where one band ends
  // mid-plot and reads as a glitch. This is a DRAWING decision only: the
  // panel's totals above run to each channel's own latest day and name it
  // ("through Jul 27"). That separation is the fix - clipping the DATA to the
  // slowest channel was throwing away real clone days, which is what made the
  // panel show 2026-07-24 while GitHub already had 07-27.
  const chartEnd =
    lastNpmDay && lastCloneDay && hasNpm && hasClones
      ? [lastNpmDay, lastCloneDay].sort()[0]
      : (lastCloneDay ?? lastNpmDay);
  let cn = 0;
  let cc = 0;
  const rows: Row[] = days.filter((day) => !chartEnd || day <= chartEnd).map((day) => {
    const e = byDay.get(day)!;
    const npmKnown = lastNpmDay !== null && day <= lastNpmDay;
    const cloneKnown = lastCloneDay !== null && day <= lastCloneDay;
    if (npmKnown) cn += e.npm;
    if (cloneKnown) cc += e.clones;
    return {
      t: Date.parse(`${day}T00:00:00Z`),
      // DAILY: a day with no published figure is a gap, not a zero.
      npm: npmKnown ? e.npm : null,
      clones: cloneKnown ? e.clones : null,
      // CUMULATIVE: hold the last known total. The areas are stacked, so a null
      // would drop the band above it to the floor; and "N installs so far"
      // stays true when no newer figure has been published - it just stops
      // growing, which is exactly what we know.
      npmCum: cn,
      clonesCum: cc,
      total: (npmKnown ? e.npm : 0) + (cloneKnown ? e.clones : 0),
      totalCum: cn + cc,
    };
  });

  const firstNpm = (npm ?? []).find((p) => p.d > 0)?.day;
  const firstClone = hasClones ? clones![0]?.day : undefined;
  const fmtDay = (d?: string) =>
    d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  // tooltip: total + each channel, colour-coded (extensible to more sources)
  const TipRow = ({ dot, k, v }: { dot: string; k: string; v: number }) => (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} />
        {k}
      </span>
      <span style={{ color: C.ink }}>{fmt(v)}</span>
    </div>
  );
  const renderTip = (props: {
    active?: boolean;
    label?: string | number;
    payload?: { payload: Row }[];
  }) => {
    if (!props.active || !props.payload?.length) return null;
    const r = props.payload[0].payload;
    const np = mode === "cum" ? r.npmCum : r.npm;
    const cl = mode === "cum" ? r.clonesCum : r.clones;
    return (
      <div
        className="numeral flex flex-col gap-1"
        style={{
          background: C.hull,
          border: `1px solid ${C.grid}`,
          color: C.dim,
          fontSize: 12,
          padding: "7px 10px",
        }}
      >
        <span style={{ color: C.dim }}>
          {new Date(Number(props.label)).toLocaleDateString("en-US", { dateStyle: "medium" })}
        </span>
        {/* a channel with no data yet for this day is omitted from the tooltip
            rather than shown as 0, which would read as "nobody installed it" */}
        <TipRow dot={C.white} k="total" v={(np ?? 0) + (cl ?? 0)} />
        {hasClones && cl !== null ? <TipRow dot={C.warn} k="git clones" v={cl} /> : null}
        {hasNpm && np !== null ? <TipRow dot={C.accent} k="npm installs" v={np} /> : null}
      </div>
    );
  };

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

      <div className="h-[260px] w-full">
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
            <Tooltip content={renderTip as unknown as ComponentProps<typeof Tooltip>["content"]} />
            {/* STACKED so the top = total: npm at the base, clones on top. A
                channel that doesn't exist yet contributes 0, so a newer source
                lifts off zero on its launch day instead of riding a false line. */}
            {mode === "cum" ? (
              <>
                {hasNpm ? (
                  <Area
                    type="monotone"
                    dataKey="npmCum"
                    name="npm installs"
                    stackId="1"
                    stroke={C.accent}
                    strokeWidth={1.4}
                    fill={C.accent}
                    fillOpacity={0.22}
                    isAnimationActive
                    animationDuration={1200}
                    dot={false}
                  />
                ) : null}
                {hasClones ? (
                  <Area
                    type="monotone"
                    dataKey="clonesCum"
                    name="git clones · unique"
                    stackId="1"
                    stroke="none"
                    fill={C.warn}
                    fillOpacity={0.16}
                    isAnimationActive
                    animationDuration={1200}
                    dot={false}
                  />
                ) : null}
                {/* the running TOTAL, traced in white on the top of the stack */}
                {hasClones ? (
                  <Line
                    type="monotone"
                    dataKey="totalCum"
                    name="total"
                    stroke={C.white}
                    strokeWidth={1.8}
                    dot={false}
                    isAnimationActive
                    animationDuration={1200}
                  />
                ) : null}
              </>
            ) : (
              <>
                {hasNpm ? (
                  <Bar dataKey="npm" name="npm installs" stackId="1" fill={C.accent} fillOpacity={0.65} isAnimationActive animationDuration={900} />
                ) : null}
                {hasClones ? (
                  <Bar dataKey="clones" name="git clones · unique" stackId="1" fill={C.warn} fillOpacity={0.55} isAnimationActive animationDuration={900} />
                ) : null}
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {hasClones ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-[10px] rounded-full" style={{ background: C.white }} />
            <span className="numeral text-micro text-dim">total acquisitions</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: C.warn }} />
            <span className="numeral text-micro text-dim">git clones · unique · since {fmtDay(firstClone)}</span>
          </span>
          {hasNpm ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: C.accent }} />
              <span className="numeral text-micro text-dim">npm installs · since {fmtDay(firstNpm)}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
