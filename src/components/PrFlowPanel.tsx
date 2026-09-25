"use client";

// PR FLOW panel: the pull-request queue as a river. A white line is the open
// queue at the START of each day; that day's bars sit ON the line: opened PRs
// rise from it (amber, what came in), merged (cyan) and closed-without-merge
// (grey) hang below it (what went out). The next day starts where the net
// landed, so the line and the bars are one picture in one unit (PRs) on one
// axis: no second scale to misread. The identity queue(d) = queue(d-1) + in -
// out holds exactly in the data (checked on all 173 days of career-ops).
// Data is precomputed by collector/prflow.mjs (UTC days, bots excluded, day in
// progress omitted); this component only draws it.
import { useMemo, useState, type ComponentProps } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import Panel from "./Panel";
import { usePalette } from "@/lib/usePalette";
import { fmt } from "@/lib/format";
import type { PrFlow } from "@/lib/prflow";

type Range = 30 | 90 | 0; // 0 = all history

interface Row {
  t: number;
  day: string | null; // null on the trailing "now" point, which only carries the queue
  start: number; // open queue when the day began (= previous day's close)
  opened: number;
  merged: number;
  closed: number;
  close: number;
  span: [number, number] | null; // [start - out, start + in]: the floating bar
  age: number | null;
}

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function PrFlowPanel({ flow, index = "01B" }: { flow: PrFlow | null; index?: string }) {
  const C = usePalette();
  const [range, setRange] = useState<Range>(90);

  const all = useMemo<Row[]>(() => {
    const days = flow?.days ?? [];
    const rows: Row[] = days.map(([day, o, m, x, open, age], i) => {
      const start = i ? days[i - 1][4] : 0;
      return {
        t: Date.parse(`${day}T00:00:00Z`),
        day,
        start,
        opened: o,
        merged: m,
        closed: x,
        close: open,
        span: o + m + x ? [start - m - x, start + o] : null,
        age,
      };
    });
    // the line runs through each day's START, so one more point closes it at
    // the start of today: the queue the stats row reports
    const lastDay = days[days.length - 1];
    if (lastDay) {
      rows.push({
        t: Date.parse(`${lastDay[0]}T00:00:00Z`) + 864e5,
        day: null,
        start: lastDay[4],
        opened: 0,
        merged: 0,
        closed: 0,
        close: lastDay[4],
        span: null,
        age: lastDay[5],
      });
    }
    return rows;
  }, [flow]);
  if (!flow || all.length < 2) return null;

  // +1: the trailing "now" point rides along with the last complete day
  const rows = range ? all.slice(-(range + 1)) : all;
  const real = all.filter((r) => r.day !== null);
  const last = real[real.length - 1];
  const week = real.slice(-7);
  const in7 = week.reduce((a, r) => a + r.opened, 0);
  const out7 = week.reduce((a, r) => a + r.merged + r.closed, 0);
  const merged7 = week.reduce((a, r) => a + r.merged, 0);
  const net7 = in7 - out7;
  // floating bars encode length, not distance from zero, so the axis can hug
  // the data: the queue's movement stays readable instead of a flat line on top
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    lo = Math.min(lo, r.span ? r.span[0] : r.start);
    hi = Math.max(hi, r.span ? r.span[1] : r.start);
  }
  // round the axis to a clean step (10 / 25 / 50 / 100…) so ticks read 0 · 100
  // · 200 · 300, not 341: the eye reads the queue off the gridlines
  const raw = Math.max(1, (hi - lo) / 4);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((v) => v >= raw) ?? 10 * mag;
  const domain: [number, number] = [
    Math.max(0, Math.floor(lo / step) * step),
    Math.ceil((hi + step * 0.15) / step) * step,
  ];
  const ticks: number[] = [];
  for (let v = domain[0]; v <= domain[1] + 1e-9; v += step) ticks.push(Math.round(v));

  const Stat = ({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="numeral text-micro tracking-[0.2em] text-faint">{label}</span>
      <span className="numeral text-2xl leading-none" style={{ color: tone ?? C.ink }}>
        {value}
      </span>
      <span className="numeral text-micro text-dim">{sub}</span>
    </div>
  );

  // a zero carries no sign and steps back: "+0" / "−0" is noise in a row that
  // has nothing to report, so it reads as a muted "0"
  const TipRow = ({ dot, k, v, sign }: { dot: string; k: string; v: number; sign?: "+" | "−" }) => {
    const zero = sign !== undefined && v === 0;
    return (
      <div className="flex items-center justify-between gap-4" style={zero ? { color: C.faint } : undefined}>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: dot, opacity: zero ? 0.35 : 1 }}
          />
          {k}
        </span>
        <span style={{ color: zero ? C.faint : C.ink }}>{zero ? "0" : `${sign ?? ""}${fmt(v)}`}</span>
      </div>
    );
  };
  const renderTip = (props: { active?: boolean; payload?: { payload: Row }[] }) => {
    if (!props.active || !props.payload?.length) return null;
    const r = props.payload[0].payload;
    if (r.day === null) return null;
    return (
      <div
        className="numeral flex flex-col gap-1"
        style={{ background: C.hull, border: `1px solid ${C.grid}`, color: C.dim, fontSize: 12, padding: "7px 10px" }}
      >
        <span style={{ color: C.dim }}>{fmtDay(r.day)} · UTC</span>
        <TipRow dot="transparent" k="queue at start" v={r.start} />
        <TipRow dot={C.warn} k="opened" v={r.opened} sign="+" />
        <TipRow dot={C.accent} k="merged" v={r.merged} sign="−" />
        <TipRow dot={C.faint} k="closed, not merged" v={r.closed} sign="−" />
        <TipRow dot={C.white} k="queue at close" v={r.close} />
        {r.age !== null ? (
          <div className="flex items-center justify-between gap-4">
            <span className="pl-3.5">median age of open</span>
            <span style={{ color: C.ink }}>{fmt(r.age)}d</span>
          </div>
        ) : null}
      </div>
    );
  };

  // One floating bar per day, split at the queue line: amber above (in), cyan
  // then grey below (out). Recharts hands us the pixel box of [low, high]; the
  // split points come from the same unit-to-pixel ratio.
  const FlowBar = (props: { x?: number; y?: number; width?: number; height?: number; payload?: Row }) => {
    const { x = 0, y = 0, width = 0, height = 0, payload: r } = props;
    if (!r?.span || height <= 0) return null;
    const ppu = height / (r.span[1] - r.span[0]);
    const w = Math.max(1, width * 0.72);
    const bx = x + (width - w) / 2;
    const hIn = r.opened * ppu;
    const hM = r.merged * ppu;
    const hX = r.closed * ppu;
    return (
      <g>
        {hIn > 0 ? <rect x={bx} y={y} width={w} height={hIn} fill={C.warn} fillOpacity={0.88} /> : null}
        {hM > 0 ? <rect x={bx} y={y + hIn} width={w} height={hM} fill={C.accent} fillOpacity={0.88} /> : null}
        {hX > 0 ? <rect x={bx} y={y + hIn + hM} width={w} height={hX} fill={C.faint} fillOpacity={0.75} /> : null}
      </g>
    );
  };

  return (
    <Panel index={index} title="PR flow" meta={`in / out · through ${fmtDay(flow.through ?? last.day ?? "")}`}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="IN · 7D" value={fmt(in7)} sub="PRs opened" tone={C.warn} />
          <Stat label="OUT · 7D" value={fmt(out7)} sub={`${fmt(merged7)} merged`} tone={C.accent} />
          <Stat
            label="OPEN QUEUE"
            value={fmt(last.close)}
            sub={`${net7 > 0 ? "+" : ""}${fmt(net7)} in 7 days`}
          />
          <Stat
            label="MEDIAN AGE"
            value={last.age !== null ? `${fmt(last.age)}d` : "–"}
            sub="of open PRs"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="numeral text-micro tracking-[0.2em] text-faint">QUEUE · DAILY IN / OUT</span>
            <div className="flex gap-1">
              {([30, 90, 0] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`numeral border px-1.5 py-0.5 text-micro tracking-[0.16em] transition-colors ${
                    range === r ? "border-accent/50 text-accent" : "border-grid text-faint hover:text-dim"
                  }`}
                >
                  {r === 0 ? "ALL" : `${r}D`}
                </button>
              ))}
            </div>
          </div>

          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin - 43200000", "dataMax + 43200000"]}
                  tickFormatter={(t: number) =>
                    new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
                  }
                  tick={{ fill: C.dim, fontSize: 11, fontFamily: "var(--font-jbmono)" }}
                  tickLine={false}
                  axisLine={{ stroke: C.grid }}
                  minTickGap={44}
                />
                <YAxis
                  domain={domain}
                  ticks={ticks}
                  tickFormatter={(v: number) => fmt(v)}
                  tick={{ fill: C.dim, fontSize: 11, fontFamily: "var(--font-jbmono)" }}
                  tickLine={false}
                  axisLine={false}
                  width={38}
                  allowDecimals={false}
                  allowDataOverflow
                />
                <Tooltip
                  cursor={{ fill: C.grid, fillOpacity: 0.35 }}
                  content={renderTip as unknown as ComponentProps<typeof Tooltip>["content"]}
                />
                <Bar dataKey="span" shape={FlowBar} isAnimationActive={false} />
                <Line
                  type="monotone"
                  dataKey="start"
                  stroke={C.white}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3, fill: C.white, stroke: C.void }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro text-dim">
            {[
              [C.warn, "opened"],
              [C.accent, "merged"],
              [C.faint, "closed, not merged"],
              [C.white, "open queue (bars sit on it)"],
            ].map(([c, k]) => (
              <span key={k} className="numeral flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />
                {k}
              </span>
            ))}
          </div>
          <span className="numeral text-micro text-faint">
            UTC days, from each PR&apos;s own timestamps · {fmt(flow.botsExcluded)} bot PRs left out · today
            is added once it closes
          </span>
        </div>
      </div>
    </Panel>
  );
}
