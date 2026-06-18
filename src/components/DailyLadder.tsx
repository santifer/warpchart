"use client";

// Stars per day (~2 months): bars + 7-day moving average, plus the night-floor
// line (avg stars/hour between 00:00 and 04:59 UTC). A floor that keeps rising
// means compounding growth, not a spike decaying. Spike days carry an amber
// forensics marker with the identified cause. The view shows ~1 month at a
// time; scroll/drag left to walk back through the two months. The Y scale is
// fixed across the whole window, so bars don't jump as you pan.
import { useMemo, useRef, useState } from "react";
import {
  ComposedChart, Bar, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import { usePalette } from "@/lib/usePalette";
import { useChartPan } from "@/lib/useChartPan";

interface Row {
  d: string;
  label: string;
  stars: number;
  ma7: number | null;
  floor: number | null;
  spike: number | null;
  cause: string | null;
}

// The compact panel shows ~1 month and pans back over the repo's FULL history;
// the full-screen deck (fill) shows ~3 months at once.
const VISIBLE_COMPACT = 31;
const VISIBLE_FILL = 93;

export default function DailyLadder({ bundle, fill }: { bundle: DashboardBundle; fill?: boolean }) {
  const live = useLive();
  const C = usePalette();

  const all = useMemo<Row[]>(() => {
    const floorByDay = new Map(bundle.floor.map((f) => [f.d, f.perHour]));
    const causeByDay = new Map(
      bundle.spikes.filter((s) => s.causes.length).map((s) => [s.date, s.causes[0].title]),
    );
    const todayKey = new Date(live.nowMs).toISOString().slice(0, 10);
    return bundle.daily.map((p, i) => {
      const stars = p.d === todayKey ? live.todayCount : p.c;
      const cause = causeByDay.get(p.d) ?? null;
      return {
        d: p.d,
        label: p.d.slice(5).replace("-", "/"),
        stars,
        ma7: bundle.ma7[i],
        floor: floorByDay.get(p.d) ?? null,
        spike: cause ? stars : null,
        cause,
      };
    });
  }, [bundle.daily, bundle.ma7, bundle.floor, bundle.spikes, live.todayCount, live.nowMs]);

  const visible = Math.min(fill ? VISIBLE_FILL : VISIBLE_COMPACT, all.length);
  const latestOff = Math.max(0, all.length - visible);
  const [offset, setOffset] = useState<number | null>(null); // null = latest
  const offRef = useRef<number | null>(null);
  offRef.current = offset;
  const off = offset ?? latestOff;
  const view = all.slice(off, off + visible);

  const ref = useChartPan((frac) => {
    const cur = offRef.current ?? latestOff;
    const next = Math.min(Math.max(Math.round(cur - frac * visible), 0), latestOff);
    if (next === cur) return false;
    setOffset(next);
    return true;
  });

  // Y scales to the VISIBLE window, not the whole life: the full history now
  // includes the launch spike (often ~10x a normal day), so a globally-fixed
  // scale would flatten recent days into invisibility. Per-window scaling keeps
  // every era legible — the axis re-fits as you pan back toward the viral start.
  const dayMax = Math.max(1, ...view.map((r) => Math.max(r.stars, r.ma7 ?? 0)));
  const floorMax = Math.max(1, ...view.map((r) => r.floor ?? 0));
  const canPan = all.length > visible;

  return (
    <div ref={ref} className={`w-full touch-pan-y ${fill ? "h-full min-h-0" : "h-[250px]"}`} style={{ cursor: canPan ? "ew-resize" : undefined }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={view} margin={{ top: 6, right: 4, left: -14, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: C.faint, fontSize: 9 }}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            interval={3}
          />
          <YAxis
            yAxisId="day"
            domain={[0, Math.ceil(dayMax * 1.05)]}
            allowDataOverflow
            tick={{ fill: C.faint, fontSize: 9 }}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <YAxis
            yAxisId="floor"
            orientation="right"
            domain={[0, Math.ceil(floorMax * 1.1)]}
            allowDataOverflow
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
          <Bar yAxisId="day" dataKey="stars" fill={C.accent} fillOpacity={0.55} maxBarSize={16} isAnimationActive={false} />
          <Line
            yAxisId="day" dataKey="ma7" stroke={C.ink} strokeWidth={1.4}
            dot={false} type="monotone" connectNulls isAnimationActive={false}
          />
          <Line
            yAxisId="floor" dataKey="floor" stroke={C.warn} strokeWidth={1}
            strokeDasharray="5 3" dot={false} type="monotone" connectNulls isAnimationActive={false}
          />
          <Scatter
            yAxisId="day" dataKey="spike" fill={C.warn} legendType="none" isAnimationActive={false}
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
