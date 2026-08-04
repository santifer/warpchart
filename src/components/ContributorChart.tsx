"use client";

// The contributor evolution strip inside Vital Signs: a time-linear daily step
// curve of WHO has landed work, with a rate histogram underneath.
//
// Two design rules carried over from the review that shaped this:
// - The x axis is LINEAR IN TIME. A month is as wide as the days it spans, so
//   a 4-day partial month is a narrow sliver at the right edge instead of a
//   full-width column that reads as a collapse.
// - The band under the curve is a RATE histogram (height = new people per day,
//   width = days). With unequal bins that is the only honest shape: area equals
//   people, and a strong short month is TALL and narrow, not small.
//
// Two readings, one toggle:
//   AUTHORS   - people who authored a landed commit (the strict census)
//   CREDITED  - authors plus Co-authored-by humans, the same definition
//               GitHub's own contributors box uses (squashes, suggestions,
//               agentic pairing). AI co-credits are counted separately and
//               never become people.
//
// Every number and sentence below is computed from the series at render time.
// Nothing is hardcoded: the copy recomputes as the data moves.
import { useMemo, useState } from "react";
import type { VitalsCensus, VitalsBusFactor } from "@/lib/vitals";

const DAY = 864e5;
const MN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const capMonth = (m: string) => m[0] + m.slice(1).toLowerCase();

type Seg = {
  label: string;
  a: number;
  b: number;
  nw: number;
  rate: number;
  partial: boolean;
};

function monthSegments(points: [string, number][], endMs: number): Seg[] {
  const t0 = Date.parse(points[0][0] + "T12:00:00Z");
  const cumAt = (ms: number) => {
    // cumulative count as of ms (points are per-day cumulative, sorted)
    let c = 0;
    for (const [d, cum] of points) {
      if (Date.parse(d + "T12:00:00Z") <= ms) c = cum;
      else break;
    }
    return c;
  };
  const start = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  };
  const next = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  };
  const out: Seg[] = [];
  for (let m = start(t0); m < endMs; m = next(m)) {
    const a = Math.max(m, t0 - 12 * 36e5); // domain starts at the first day
    const b = Math.min(next(m), endMs);
    const nw = cumAt(b) - cumAt(a - DAY / 2);
    out.push({
      label: MN[new Date(m).getUTCMonth()],
      a,
      b,
      nw,
      rate: nw / ((b - a) / DAY),
      partial: next(m) > endMs,
    });
  }
  return out;
}

export default function ContributorChart({
  census,
  busFactor,
}: {
  census: VitalsCensus;
  busFactor: VitalsBusFactor | null;
}) {
  const [mode, setMode] = useState<"a" | "c">("a");
  const pts = mode === "a" ? census.authorsDaily : census.creditedDaily;
  const N = mode === "a" ? census.authors : census.credited;

  const model = useMemo(() => {
    if (!pts.length) return null;
    const endMs = census.measuredAt
      ? Date.parse(census.measuredAt)
      : Date.parse(pts[pts.length - 1][0] + "T23:59:59Z");
    const t0 = Date.parse(pts[0][0] + "T12:00:00Z");
    const segs = monthSegments(pts, endMs);
    const maxRate = Math.max(...segs.map((s) => s.rate));
    const complete = segs.filter((s) => !s.partial);
    const cur = segs[segs.length - 1];
    const best = (complete.length ? complete : segs).reduce((x, y) => (y.nw > x.nw ? y : x));
    const cut30 = endMs - 30 * DAY;
    const last30 = pts.length
      ? N - (pts.filter(([d]) => Date.parse(d + "T12:00:00Z") < cut30).at(-1)?.[1] ?? 0)
      : 0;
    return { endMs, t0, segs, maxRate, cur, best, last30 };
  }, [pts, N, census.measuredAt]);

  if (!model) return null;
  const { endMs, t0, segs, maxRate, cur, best, last30 } = model;

  // ---- geometry ----
  const W = 960,
    X0 = 8,
    X1 = W - 52,
    CT = 12,
    CB = 102,
    HT = 116,
    HB = 154,
    LBL = 172;
  const x = (t: number) => X0 + ((t - t0) / (endMs - t0)) * (X1 - X0);
  const yMax = Math.max(50, Math.ceil(N / 50) * 50);
  const y = (v: number) => CB - (v / yMax) * (CB - CT);
  const yr = (r: number) => HB - (r / maxRate) * (HB - HT);

  let path = `M${x(Date.parse(pts[0][0] + "T12:00:00Z"))},${y(0)}`;
  let prev = 0;
  for (const [d, cum] of pts) {
    const px = x(Date.parse(d + "T12:00:00Z"));
    path += ` L${px},${y(prev)} L${px},${y(cum)}`;
    prev = cum;
  }
  path += ` L${x(endMs)},${y(prev)}`;

  const othersPct = busFactor ? Math.round((1 - busFactor.top1Share) * 100) : null;
  const curDays = Math.max(1, Math.round((endMs - cur.a) / DAY));
  const fastest = cur.rate >= maxRate - 1e-9;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex border border-grid" role="tablist" aria-label="Contributor definition">
          {(
            [
              ["a", `AUTHORS ${census.authors}`],
              ["c", `+ CO-AUTHORED ${census.credited}`],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`numeral cursor-pointer px-3 py-1 text-micro tracking-[0.1em] transition-colors ${
                mode === m ? "bg-accent/15 text-accent" : "text-faint hover:text-dim"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="numeral text-micro text-faint">
          <span className="text-accent">{last30}</span> of {N} arrived in the last 30 days
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${LBL + 8}`}
        className="block w-full"
        role="img"
        aria-label={`Cumulative ${mode === "a" ? "authors" : "credited contributors"} over time, daily`}
      >
        <line x1={X0} y1={CB} x2={X1} y2={CB} stroke="var(--grid)" />
        <line x1={X0} y1={y(yMax)} x2={X1} y2={y(yMax)} stroke="var(--grid)" opacity=".55" />
        <text x={X0} y={y(yMax) - 4} className="numeral" fontSize="9" fill="var(--faint)">
          {yMax}
        </text>
        {segs.slice(1).map((s) => (
          <line
            key={`b${s.a}`}
            x1={x(s.a)}
            y1={CT}
            x2={x(s.a)}
            y2={HB}
            stroke="var(--grid)"
            opacity=".6"
          />
        ))}
        {segs.map((s) => {
          const w = x(s.b) - x(s.a);
          return (
            <text
              key={`l${s.a}`}
              x={w < 34 ? x(s.b) : (x(s.a) + x(s.b)) / 2}
              y={LBL}
              textAnchor={w < 34 ? "end" : "middle"}
              className="numeral"
              fontSize="9.5"
              letterSpacing="1"
              fill="var(--faint)"
            >
              {s.label}
            </text>
          );
        })}
        <path d={`${path} L${x(endMs)},${CB} L${x(t0)},${CB} Z`} fill="var(--accent-soft)" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
        <circle cx={x(endMs)} cy={y(N)} r="6.5" fill="var(--glow)" opacity=".5" />
        <circle cx={x(endMs)} cy={y(N)} r="3" fill="var(--accent)" />
        <text
          x={x(endMs) + 8}
          y={y(N) + 4}
          className="numeral"
          fontSize="14"
          fontWeight="600"
          fill="var(--ink)"
        >
          {N}
        </text>
        {segs.map((s) => {
          const bx = x(s.a) + 1;
          const bw = Math.max(2, x(s.b) - x(s.a) - 2);
          const by = yr(s.rate);
          return (
            <g key={`r${s.a}`}>
              <rect
                x={bx}
                y={by}
                width={bw}
                height={HB - by}
                fill="var(--accent)"
                opacity={s.partial ? 0.95 : 0.55}
              />
              <text
                x={bw < 34 ? x(s.b) : bx + bw / 2}
                y={by - 3}
                textAnchor={bw < 34 ? "end" : "middle"}
                className="numeral"
                fontSize="9"
                fill={s.rate === maxRate ? "var(--warn)" : "var(--faint)"}
              >
                {s.rate.toFixed(1)}/d
              </text>
            </g>
          );
        })}
        <text
          x={X0}
          y={HT - 3}
          className="numeral"
          fontSize="8.5"
          letterSpacing="1"
          fill="var(--faint)"
          opacity=".8"
        >
          NEW {mode === "a" ? "AUTHORS" : "CREDITED PEOPLE"} / DAY
        </text>
      </svg>

      {busFactor ? (
        <div className="flex items-center gap-3">
          <span className="numeral shrink-0 text-micro tracking-[0.08em] text-faint">
            BUS FACTOR
          </span>
          <div className="flex h-1.5 flex-1 gap-0.5">
            <div style={{ width: `${(busFactor.top1Share * 100).toFixed(1)}%`, background: "var(--warn)" }} />
            <div
              style={{
                width: `${((busFactor.top5Share - busFactor.top1Share) * 100).toFixed(1)}%`,
                background: "var(--accent)",
              }}
            />
            <div className="flex-1 bg-grid" />
          </div>
          <span className="numeral shrink-0 text-micro text-faint">
            maintainer {Math.round(busFactor.top1Share * 100)}% · next 4{" "}
            {Math.round((busFactor.top5Share - busFactor.top1Share) * 100)}% · others{" "}
            {Math.round((1 - busFactor.top5Share) * 100)}%
          </span>
        </div>
      ) : null}

      <div className="numeral text-micro leading-relaxed text-faint">
        {mode === "a" ? (
          <>
            <span className="text-dim">{N} people</span> have authored a landed commit since{" "}
            {capMonth(segs[0].label)}.
            {othersPct !== null ? (
              <>
                {" "}
                <span className="text-accent">{othersPct}% of all commits</span> come from someone
                other than the maintainer.
              </>
            ) : null}
          </>
        ) : (
          <>
            <span className="text-dim">{N} people</span> are credited on landed commits since{" "}
            {capMonth(segs[0].label)}: {census.authors} authors plus{" "}
            <span className="text-accent">{census.credited - census.authors} co-authors</span> via
            squashes, suggestions and agentic pairing.
          </>
        )}{" "}
        {capMonth(best.label)} brought <span className="text-dim">{best.nw} first-timers</span>;{" "}
        {fastest ? (
          <>
            <span className="text-accent">{cur.rate.toFixed(1)} new/day</span> so far in{" "}
            {capMonth(cur.label)}, the fastest pace on record.
          </>
        ) : (
          <>
            <span className="text-dim">{cur.rate.toFixed(1)} new/day</span> so far in{" "}
            {capMonth(cur.label)}.
          </>
        )}
      </div>
      <span className="numeral text-micro text-faint/60">
        commit census
        {census.measuredAt ? ` · measured ${census.measuredAt.slice(0, 10)}` : ""} ·{" "}
        {capMonth(cur.label)} spans {curDays} day{curDays === 1 ? "" : "s"} · bots and service
        accounts excluded
        {mode === "c"
          ? ` · same definition as GitHub's contributors box · AI co-credits tracked apart (${census.aiCoCredits})`
          : ""}
      </span>
    </div>
  );
}
