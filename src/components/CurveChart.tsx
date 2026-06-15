"use client";

// Interactive cumulative chart for explorer pages: same visual language as
// the unlocked console's CumulativeChart, fed by /api/curve (the cached
// reconstruction shared with the SVG embed). The draw animation fires ONCE
// when the panel enters the viewport (here we have JS, unlike a README),
// and REPLAY re-runs it on demand. The estimated stretch beyond GitHub's
// 40K pagination cap renders dashed and labeled, never disguised.
import { useEffect, useRef, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { usePalette } from "@/lib/usePalette";
import { fmt, fmtCompact } from "@/lib/format";

interface CurveDto {
  repo: string;
  total: number;
  pts: { t: number; v: number }[];
  dashedFrom: number | null;
  archiveFrom?: number | null;
  exactFrom?: number | null;
}

interface Row {
  t: number;
  solid: number | null;
  est: number | null;
}

export default function CurveChart({ repo, fill }: { repo: string; fill?: boolean }) {
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
      <div ref={hostRef} className={`numeral flex items-center justify-center text-label text-warn ${fill ? "h-full min-h-[180px]" : "h-[260px]"}`}>
        TRAJECTORY SCAN FAILED · retry on next visit
      </div>
    );
  }

  if (!curve) {
    return (
      <div ref={hostRef} className={`numeral flex items-center justify-center text-label text-dim ${fill ? "h-full min-h-[180px]" : "h-[260px]"}`}>
        {visible ? "RECONSTRUCTING TRAJECTORY… first scan can take ~20s" : "…"}
      </div>
    );
  }

  const boundary = curve.dashedFrom;
  const exactStart = curve.exactFrom ?? null;
  const seam = curve.archiveFrom ?? null;
  const seamT = seam !== null ? (curve.pts[seam]?.t ?? null) : null;
  const exactT = exactStart !== null ? (curve.pts[exactStart]?.t ?? null) : null;
  // Only signpost the exact-daily takeover once it spans a visible slice of the
  // x-axis. A few recorded days on a multi-year repo sit on the right edge and
  // the label clips to a bare arrow; the tail is exact regardless. Self-arms as
  // the recorded window grows toward the 90-day cap.
  const spanT = curve.pts.length > 1 ? curve.pts[curve.pts.length - 1].t - curve.pts[0].t : 0;
  const exactWide =
    exactT !== null && spanT > 0 && (curve.pts[curve.pts.length - 1].t - exactT) / spanT > 0.12;
  // The trustworthy stretch (exact api + normalized archive + our exact-recent
  // daily record) is ONE continuous filled series; only a genuinely estimated
  // middle (archive unavailable) draws dashed, and it is BOUNDED at exactStart
  // so the recent window we recorded never renders as a guess. Boundary and
  // exactStart points belong to both series so the pens meet without a gap.
  const rows: Row[] = curve.pts.map((p, i) => {
    const inEst = boundary !== null && i >= boundary && (exactStart === null || i <= exactStart);
    const inSolid = !inEst || i === boundary || i === exactStart;
    return { t: p.t, solid: inSolid ? p.v : null, est: inEst ? p.v : null };
  });

  return (
    <div ref={hostRef} className={`flex flex-col gap-2 ${fill ? "h-full min-h-0" : ""}`}>
      <div className={`w-full ${fill ? "min-h-0 flex-1" : "h-[280px]"}`}>
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
              formatter={(value, name, item) => {
                const at = (item as { payload?: { t?: number } }).payload?.t ?? 0;
                return [
                  `${fmt(Number(value))} ★`,
                  name === "est"
                    ? "estimated middle (api cap)"
                    : exactT !== null && at >= exactT
                      ? "exact daily · recorded"
                      : seamT !== null && at > seamT
                        ? "gh archive (real, normalized)"
                        : "stars",
                ];
              }}
              labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("en-US", { dateStyle: "medium" })}
            />
            {seamT !== null && (
              <ReferenceLine
                x={seamT}
                stroke={C.grid}
                strokeDasharray="2 5"
                label={{
                  value: "api | archive",
                  position: "insideTop",
                  fill: C.dim,
                  fontSize: 11,
                  fontFamily: "var(--font-jbmono)",
                }}
              />
            )}
            {exactWide && (
              // where our own exact daily record takes over from the reconstruction
              <ReferenceLine
                x={exactT as number}
                stroke={C.accent}
                strokeOpacity={0.5}
                strokeDasharray="2 5"
                label={{
                  value: "← exact daily",
                  position: "insideTopLeft",
                  fill: C.accent,
                  fontSize: 11,
                  fontFamily: "var(--font-jbmono)",
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="solid"
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
              animationBegin={1900}
              animationDuration={700}
              dot={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="numeral text-micro text-faint">
          {exactWide
            ? "exact api timestamps + the recent window recorded EXACTLY, daily — our own record beyond GitHub's 40K cap"
            : seam !== null
              ? "full real history: exact api timestamps + gh archive beyond the 40K cap (normalized to the live total)"
              : boundary !== null
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
