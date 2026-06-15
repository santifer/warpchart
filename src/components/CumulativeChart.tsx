"use client";

// Total stars over the whole mission. Y axis pinned from 0 to the current
// total, X axis is time. REPLAY mode re-draws the journey from day zero with
// a running readout; with sound on, ping density follows the moment's
// velocity, so you can hear the viral spike.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import { usePalette } from "@/lib/usePalette";
import { fmtCompact, fmt } from "@/lib/format";
import { sound } from "@/lib/sound";

const TICK_MS = 70;
const REPLAY_SECONDS = 36;

function downsample<T>(arr: T[], maxPoints = 700): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  const out = arr.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

export default function CumulativeChart({ bundle, fill }: { bundle: DashboardBundle; fill?: boolean }) {
  const live = useLive();
  const C = usePalette();
  const [replayIdx, setReplayIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const idxRef = useRef(0);

  // cumulative series over the whole life, from hourly buckets
  const cumAll = useMemo(() => {
    let total = 0;
    return bundle.hourlyAll.map((h) => {
      total += h.c;
      return { t: h.t, total, c: h.c };
    });
  }, [bundle.hourlyAll]);

  const liveData = useMemo(() => {
    const base = bundle.cumulative.map((p) => ({ t: p.t, total: p.total }));
    const grossNow = bundle.totalStars + (live.merged.length - bundle.recent48h.length);
    base.push({ t: live.nowMs, total: grossNow });
    return base;
  }, [bundle.cumulative, bundle.totalStars, bundle.recent48h.length, live.merged.length, live.nowMs]);

  // replay engine
  useEffect(() => {
    if (!playing || !cumAll.length) return;
    const step = Math.max(1, Math.round(cumAll.length / ((REPLAY_SECONDS * 1000) / TICK_MS)));
    const id = setInterval(() => {
      const next = Math.min(idxRef.current + step, cumAll.length - 1);
      // sonification: ping when stars landed in the hours we just crossed
      let added = 0;
      for (let i = idxRef.current + 1; i <= next; i++) added += cumAll[i].c;
      if (added > 0) sound.ping(Math.min(added / 400, 1));
      idxRef.current = next;
      setReplayIdx(next);
      if (next >= cumAll.length - 1) setPlaying(false);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, cumAll]);

  const replaying = replayIdx !== null;
  const data = replaying
    ? downsample(cumAll.slice(0, Math.max(replayIdx! + 1, 2)))
    : liveData;
  const finalTotal = cumAll.length ? cumAll[cumAll.length - 1].total : 1;
  const yMax = replaying ? finalTotal : (liveData[liveData.length - 1]?.total ?? 1);
  const xDomain: [number, number] | ["dataMin", "dataMax"] =
    replaying && cumAll.length
      ? [cumAll[0].t, cumAll[cumAll.length - 1].t]
      : ["dataMin", "dataMax"];

  const startReplay = () => {
    idxRef.current = 0;
    setReplayIdx(0);
    setPlaying(true);
  };
  const exitReplay = () => {
    setPlaying(false);
    setReplayIdx(null);
  };

  const cursor = replaying ? cumAll[Math.min(replayIdx!, cumAll.length - 1)] : null;

  return (
    <div className={`flex flex-col gap-2 ${fill ? "h-full min-h-0" : ""}`}>
      <div className={`relative w-full ${fill ? "min-h-0 flex-1" : "h-[218px]"}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 4, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.accent} stopOpacity={0.32} />
                <stop offset="100%" stopColor={C.accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={xDomain}
              tickFormatter={(t: number) =>
                new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              }
              tick={{ fill: C.faint, fontSize: 9 }}
              tickLine={false}
              axisLine={{ stroke: C.grid }}
              minTickGap={48}
            />
            <YAxis
              domain={[0, yMax]}
              tickFormatter={(v: number) => fmtCompact(v)}
              tick={{ fill: C.faint, fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              contentStyle={{
                background: C.hull, border: `1px solid ${C.grid}`, borderRadius: 0,
                fontSize: 11, fontFamily: "var(--font-jbmono)",
              }}
              labelStyle={{ color: C.dim }}
              labelFormatter={(t) =>
                new Date(Number(t)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              }
              formatter={(value) => [fmt(Number(value)), "stars"]}
            />
            <Area
              dataKey="total"
              stroke={C.accent}
              strokeWidth={1.4}
              fill="url(#cumFill)"
              dot={false}
              type="monotone"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        {cursor ? (
          <div className="numeral pointer-events-none absolute right-3 top-2 border border-grid bg-hull/80 px-3 py-1.5 text-right">
            <div className="text-label text-dim">
              {new Date(cursor.t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
            <div className="glow-accent text-base text-accent">{fmt(cursor.total)} ★</div>
          </div>
        ) : null}
      </div>

      {/* replay controls */}
      <div className="numeral flex items-center gap-3 text-label">
        {!replaying ? (
          <button
            onClick={startReplay}
            className="border border-grid px-2.5 py-1 tracking-[0.2em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
          >
            ▶ REPLAY
          </button>
        ) : (
          <>
            <button
              onClick={() => setPlaying(!playing)}
              className="border border-grid px-2.5 py-1 tracking-[0.2em] text-accent"
            >
              {playing ? "⏸" : "▶"}
            </button>
            <input
              type="range"
              min={0}
              max={cumAll.length - 1}
              value={replayIdx ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                idxRef.current = v;
                setReplayIdx(v);
              }}
              className="h-[3px] flex-1 cursor-pointer appearance-none bg-grid accent-[var(--accent)]"
            />
            <button
              onClick={exitReplay}
              className="border border-grid px-2.5 py-1 tracking-[0.2em] text-faint transition-colors hover:text-ink"
            >
              ✕ EXIT
            </button>
          </>
        )}
        {!replaying ? (
          <span className="text-faint">replay the whole journey from day zero</span>
        ) : null}
      </div>
    </div>
  );
}
