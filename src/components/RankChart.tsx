"use client";

// Worldwide rank over time, from hourly snapshots. Y axis reversed (up means
// climbing). Defaults to the last ~2 months; scroll/drag left to reveal older
// history, and the Y axis auto-fits the visible window so the line always
// fills the panel. Grows richer as snapshots accumulate.
import { useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import { usePalette } from "@/lib/usePalette";
import { useChartPan } from "@/lib/useChartPan";

const WINDOW_MS = 62 * 24 * 3600 * 1000; // ~2 months

export default function RankChart({ bundle, fill }: { bundle: DashboardBundle; fill?: boolean }) {
  const live = useLive();
  const C = usePalette();

  const data = useMemo(() => {
    const base = bundle.rankHistory.map((p) => ({ t: p.t, rank: p.rank }));
    if (live.rank !== null) base.push({ t: live.nowMs, rank: live.rank });
    base.sort((a, b) => a.t - b.t);
    return base;
  }, [bundle.rankHistory, live.rank, live.nowMs]);

  const tMin = data.length ? data[0].t : 0;
  const tMax = data.length ? data[data.length - 1].t : 0;
  const W = Math.max(1, Math.min(WINDOW_MS, tMax - tMin));
  const latestStart = Math.max(tMin, tMax - W);

  // null = follow the latest window; a number = user has panned to it
  const [winStart, setWinStart] = useState<number | null>(null);
  const panRef = useRef<number | null>(null);
  panRef.current = winStart;

  const effStart = winStart ?? latestStart;
  const effEnd = effStart + W;

  const ref = useChartPan((frac) => {
    const cur = panRef.current ?? latestStart;
    const next = Math.min(Math.max(cur - frac * W, tMin), Math.max(tMin, tMax - W));
    if (next === cur) return false;
    setWinStart(next);
    return true;
  });

  // Y auto-fit: only the ranks inside the visible window drive the scale.
  const yDomain = useMemo<[number, number]>(() => {
    const vis = data.filter((p) => p.t >= effStart && p.t <= effEnd);
    const ranks = (vis.length ? vis : data).map((p) => p.rank);
    const lo = Math.min(...ranks), hi = Math.max(...ranks);
    return [lo - 2, hi + 2];
  }, [data, effStart, effEnd]);
  // Even ticks on round ranks: recharts' own ticks on this padded domain
  // ended with the boundary value ("#268 #273", 5 apart after steps of 15),
  // which reads as a broken scale. Multiples of a 1-2-5 step instead.
  const yTicks = useMemo(() => {
    const [a, b] = yDomain;
    const raw = (b - a) / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    const step = [1, 2, 5, 10].map((k) => k * mag).find((x) => x >= raw) ?? 10 * mag;
    const out: number[] = [];
    // deck: the domain snaps outward to whole steps, so the current rank
    // (the line's end) is never above the highest labelled tick
    const lo = fill ? Math.floor(a / step) * step : Math.ceil(a / step) * step;
    const hi = fill ? Math.ceil(b / step) * step : b;
    for (let v = lo; v <= hi; v += step) out.push(v);
    return out;
  }, [yDomain, fill]);
  const yDom: [number, number] = fill && yTicks.length ? [yTicks[0], yTicks[yTicks.length - 1]] : yDomain;
  // deck: the same date marks as the Daily ladder beside it, every 14 days
  // counted back from today (UTC), so the two axes pair day for day
  const xTicks = useMemo(() => {
    if (!fill) return undefined;
    const today = Math.floor(live.nowMs / 864e5) * 864e5;
    const out: number[] = [];
    for (let t = today; t >= effStart; t -= 14 * 864e5) if (t <= effEnd) out.push(t);
    return out.reverse();
  }, [fill, live.nowMs, effStart, effEnd]);

  if (data.length < 5) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 ${fill ? "h-full min-h-0" : "h-[230px]"}`}>
        <span className="font-display text-label tracking-[0.3em] text-dim">ACCUMULATING HISTORY</span>
        <span className="numeral text-label text-faint">
          {data.length} snapshot{data.length === 1 ? "" : "s"} · one per hour from now on
        </span>
      </div>
    );
  }

  const canPan = tMax - tMin > W + 1;

  return (
    <div ref={ref} className={`w-full touch-pan-y ${fill ? "h-full min-h-0" : "h-[230px]"}`} style={{ cursor: canPan ? "ew-resize" : undefined }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: fill ? 22 : 8, left: -14, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[effStart, effEnd]}
            ticks={xTicks}
            allowDataOverflow
            tickFormatter={(t: number) =>
              new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
            }
            tick={{ fill: C.faint, fontSize: fill ? 11 : 9 }}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            minTickGap={fill ? 0 : 56}
          />
          <YAxis
            reversed
            domain={yDom}
            ticks={yTicks}
            allowDataOverflow
            allowDecimals={false}
            tickFormatter={(v: number) => `#${v}`}
            tick={{ fill: C.faint, fontSize: fill ? 11 : 9 }}
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
