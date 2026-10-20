"use client";

// Where a repo placed, DAY BY DAY, among the worldwide top 1,000 by new stars
// that day (lower is better). Locked like the world-rank panel: only the
// owner's god token (localStorage "wc_god", set via /unlock?k=) fetches the
// gated /api/v1/velocity-rank; everyone else sees the locked teaser. Client-side
// on purpose so the public page keeps its ISR cache.
//
// Two marks: the day's rank (thin, gappy where a day was not measurable) and
// the trailing 7-day median (the trend under the noise). A gap is a day we did
// not measure, never drawn as a bad day.
import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { usePalette } from "@/lib/usePalette";
import { fillCalendar, rankTicks, trailingMedian, weekOverWeek } from "@/lib/velocity-rank-view";
import { StepsSilhouette } from "./PanelSilhouettes";

type Pt = { day: string; rank: number | null; gain: number | null; n: number; hours: number | null; inTop?: boolean; why?: string };
type State =
  | { kind: "locked" }
  | { kind: "unavailable" }
  | { kind: "empty" }
  | { kind: "data"; top: number; pts: Pt[] };

const H = 260;
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function LockedTeaser({ repo }: { repo: string }) {
  return (
    <div className="relative">
      <div className="pointer-events-none select-none opacity-[0.28] blur-[2px]" aria-hidden>
        <StepsSilhouette h={H} />
      </div>
      <a href={`/pricing?repo=${encodeURIComponent(repo)}`} className="absolute inset-0 z-10" aria-label={`See what tracking ${repo} unlocks`} />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="numeral border border-grid bg-void/70 px-2.5 py-1 text-micro tracking-[0.28em] text-faint">
          ◈ UNLOCK WITH TRACKING
        </span>
      </div>
    </div>
  );
}

export default function GodVelocityRank({ repo }: { repo: string }) {
  const C = usePalette();
  const [state, setState] = useState<State>({ kind: "locked" });

  useEffect(() => {
    // starts (and, without a token, stays) locked; the teaser shows while the
    // fetch is in flight instead of a synchronous "loading" state
    const tok = typeof window !== "undefined" ? localStorage.getItem("wc_god") : null;
    if (!tok) return;
    let stop = false;
    fetch(`/api/v1/velocity-rank?repo=${encodeURIComponent(repo)}&k=${encodeURIComponent(tok)}`)
      .then(async (r) => ({ status: r.status, body: r.ok ? await r.json() : null }))
      .then(({ status, body }) => {
        if (stop) return;
        // 403 behaves exactly like a locked panel (no token leak); 503 = the
        // day table is missing, said as such instead of an empty chart
        if (status === 503) return setState({ kind: "unavailable" });
        if (!body) return setState({ kind: "locked" });
        const pts = (body.points ?? []) as Pt[];
        setState(pts.filter((p) => p.rank != null).length >= 2 ? { kind: "data", top: body.top ?? 1000, pts } : { kind: "empty" });
      })
      .catch(() => !stop && setState({ kind: "locked" }));
    return () => {
      stop = true;
    };
  }, [repo]);

  const view = useMemo(() => {
    if (state.kind !== "data") return null;
    // every calendar day, so an unmeasured day breaks the line instead of
    // being bridged
    const full = fillCalendar(state.pts) as (Partial<Pt> & { day: string; rank: number | null })[];
    const med = trailingMedian(full);
    const data = full.map((p, i) => ({ ...p, t: Date.parse(`${p.day}T12:00:00Z`), med: med[i] }));
    const worst = Math.max(...state.pts.map((p) => p.rank ?? 0));
    const yMax = Math.min(state.top, Math.ceil((worst * 1.05) / 10) * 10);
    return { data, wow: weekOverWeek(state.pts), yMax, ticks: rankTicks(yMax) };
  }, [state]);

  if (state.kind === "locked") return <LockedTeaser repo={repo} />;
  if (state.kind === "unavailable" || state.kind === "empty") {
    const msg = {
      unavailable: "VELOCITY RANK UNAVAILABLE · the daily table is not built yet",
      empty: `NOT RANKED YET · ${repo} has fewer than 2 measured days`,
    }[state.kind];
    return (
      <div className="flex items-center justify-center" style={{ height: H }}>
        <span className="numeral text-label tracking-[0.3em] text-dim">{msg}</span>
      </div>
    );
  }

  const { data, wow, yMax, ticks } = view!;
  const top = state.top.toLocaleString("en-US");
  const since = dayLabel(state.pts[0].day);
  const better = wow.thisWeek != null && wow.prevWeek != null ? wow.prevWeek - wow.thisWeek : null;

  return (
    <div className="relative flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-1">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="numeral text-label text-ink">
            <span className="text-micro tracking-[0.2em] text-faint">LAST DAY </span>#{wow.last}
            <span className="text-micro text-faint"> · {dayLabel(wow.lastDay!)}</span>
          </span>
          <span className="numeral text-label text-ink">
            <span className="text-micro tracking-[0.2em] text-faint">7-DAY MEDIAN </span>
            {wow.thisWeek != null ? `#${wow.thisWeek}` : "n/a"}
            {better != null && (
              <span className="text-micro text-faint">
                {" "}
                · {better > 0 ? `${better} places better` : better < 0 ? `${-better} places worse` : "same"} than the week before (#{wow.prevWeek})
              </span>
            )}
          </span>
          {wow.best && (
            <span className="numeral text-label text-ink">
              <span className="text-micro tracking-[0.2em] text-faint">BEST </span>#{wow.best.rank}
              <span className="text-micro text-faint"> · {dayLabel(wow.best.day)}</span>
            </span>
          )}
        </div>
        <span className="numeral text-micro tracking-[0.24em] text-accent/70">◈ GOD MODE</span>
      </div>
      <div style={{ height: H }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 18, left: -14, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
              tick={{ fill: C.faint, fontSize: 9 }}
              tickLine={false}
              axisLine={{ stroke: C.grid }}
              minTickGap={56}
            />
            <YAxis
              reversed
              domain={[1, yMax]}
              ticks={ticks}
              allowDecimals={false}
              tickFormatter={(v: number) => `#${v}`}
              tick={{ fill: C.faint, fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={{ background: C.hull, border: `1px solid ${C.grid}`, borderRadius: 0, fontSize: 11, fontFamily: "var(--font-jbmono)" }}
              labelStyle={{ color: C.dim }}
              labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
              formatter={(value, name, item) => {
                const p = (item as { payload?: (typeof data)[number] })?.payload;
                if (name === "med") return [value != null ? `#${value}` : "n/a", "7-day median"];
                if (!p || p.rank == null) return [p?.why === "step" ? "star purge or restore: not ranked" : "not measured", "that day"];
                const w = p.hours != null ? ` in ${p.hours} h` : "";
                const g = p.gain ?? 0;
                const net = `${g >= 0 ? "+" : "−"}${Math.abs(g).toLocaleString("en-US")} net ★${w}`;
                // outside the top 1,000 the rank is where it WOULD have placed
                const place = p.inTop === false ? `would place #${p.rank}` : `#${p.rank} of ${(p.n ?? 0).toLocaleString("en-US")}`;
                return [`${place} · ${net}`, "by new stars"];
              }}
            />
            <Line
              dataKey="rank"
              name="rank"
              stroke={C.dim}
              strokeOpacity={0.55}
              strokeWidth={1}
              dot={{ r: 2, fill: C.dim, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="med"
              name="med"
              stroke={C.accent}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              type="monotone"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <span className="numeral px-1 text-micro text-faint">
        {state.pts.some((p) => p.inTop === false) ? `where it placed (or would have) among the worldwide top ${top}` : `place among the worldwide top ${top}`} by net new stars that day · lower is better · line = 7-day median · gaps = day not measured · recorded since {since}
      </span>
    </div>
  );
}
