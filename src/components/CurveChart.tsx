"use client";

// Interactive cumulative chart for explorer pages: same visual language as
// the unlocked console's CumulativeChart, fed by /api/curve (the cached
// reconstruction shared with the SVG embed). The draw animation fires ONCE
// when the panel enters the viewport (here we have JS, unlike a README),
// and REPLAY re-runs it on demand. The estimated stretch beyond GitHub's
// 40K pagination cap renders dashed and labeled, never disguised.
import { useEffect, useRef, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { usePalette } from "@/lib/usePalette";
import { fmt, fmtCompact } from "@/lib/format";

interface CurveDto {
  repo: string;
  total: number;
  pts: { t: number; v: number }[];
  dashedFrom: number | null;
}

interface Row {
  t: number;
  real: number | null;
  est: number | null;
}

export default function CurveChart({ repo }: { repo: string }) {
  const C = usePalette();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [curve, setCurve] = useState<CurveDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [run, setRun] = useState(0); // replay key

  // start loading (and later animating) only when the panel is on screen
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let stop = false;
    (async () => {
      try {
        const res = await fetch(`/api/curve?repo=${encodeURIComponent(repo)}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as CurveDto;
        if (!stop) setCurve(data);
      } catch {
        if (!stop) setFailed(true);
      }
    })();
    return () => {
      stop = true;
    };
  }, [visible, repo]);

  if (failed) {
    return (
      <div ref={hostRef} className="numeral flex h-[260px] items-center justify-center text-label text-warn">
        TRAJECTORY SCAN FAILED · retry on next visit
      </div>
    );
  }

  if (!curve) {
    return (
      <div ref={hostRef} className="numeral flex h-[260px] items-center justify-center text-label text-dim">
        {visible ? "RECONSTRUCTING TRAJECTORY… first scan can take ~20s" : "…"}
      </div>
    );
  }

  const boundary = curve.dashedFrom;
  const rows: Row[] = curve.pts.map((p, i) => ({
    t: p.t,
    real: boundary === null || i <= boundary ? p.v : null,
    est: boundary !== null && i >= boundary ? p.v : null,
  }));

  return (
    <div ref={hostRef} className="flex flex-col gap-2">
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart key={run} data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) =>
                new Date(t).toLocaleDateString("en-US", { month: "short", year: "2-digit" })
              }
              tick={{ fill: C.dim, fontSize: 12, fontFamily: "var(--font-jbmono)" }}
              tickLine={false}
              axisLine={{ stroke: C.grid }}
            />
            <YAxis
              tickFormatter={(v: number) => fmtCompact(v)}
              tick={{ fill: C.dim, fontSize: 12, fontFamily: "var(--font-jbmono)" }}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <Tooltip
              contentStyle={{
                background: C.hull,
                border: `1px solid ${C.grid}`,
                fontFamily: "var(--font-jbmono)",
                fontSize: 13,
              }}
              labelStyle={{ color: C.dim }}
              formatter={(value, name) => [
                `${fmt(Number(value))} ★`,
                name === "est" ? "estimated (api cap)" : "stars",
              ]}
              labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("en-US", { dateStyle: "medium" })}
            />
            <Area
              type="monotone"
              dataKey="real"
              stroke={C.accent}
              strokeWidth={1.6}
              fill={C.accentSoft}
              isAnimationActive
              animationDuration={1900}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="linear"
              dataKey="est"
              stroke={C.accent}
              strokeWidth={1.2}
              strokeDasharray="3 5"
              strokeOpacity={0.55}
              isAnimationActive
              animationBegin={1500}
              animationDuration={900}
              dot={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="numeral text-micro text-faint">
          {boundary !== null
            ? "solid = real stargazer timestamps · dashed = estimated beyond GitHub's 40K api cap"
            : "every point is a real stargazer timestamp"}
        </span>
        <button
          onClick={() => setRun((r) => r + 1)}
          className="numeral border border-grid px-3 py-1.5 text-micro tracking-[0.2em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
        >
          ↻ REPLAY
        </button>
      </div>
    </div>
  );
}
