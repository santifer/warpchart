"use client";

// The velocity rankings board: three lenses over the top-1000 universe.
// ABSOLUTE (stars/day), RELATIVE (%/day, growth against own size) and
// HUNTS (active overtakes with an eta). Every row is a ship on a lane:
// tail length is the velocity on a shared scale, hue is the doppler tilt
// against the registry's median pace. Static SVG only, zero runtime cost.
import { useState } from "react";
import Link from "next/link";
import { usePalette } from "@/lib/usePalette";
import { dopplerTilt } from "@/lib/doppler";
import { fmt, fmtCompact, shortName } from "@/lib/format";

export interface LaneRepo {
  r: string;
  s: number;
  rank: number;
  v: number;
  l: string | null;
  relPct: number; // daily growth as % of own size
  hunt?: { victim: string; eta: string } | null;
}

export interface HuntRow {
  hunter: string;
  victim: string;
  hunterV: number;
  victimRank: number;
  gap: number;
  eta: string;
  etaDays: number;
  angles: string[];
}

type Lens = "absolute" | "relative" | "hunts";

const LENSES: { key: Lens; label: string; hint: string }[] = [
  { key: "absolute", label: "FASTEST", hint: "stars per day" },
  { key: "relative", label: "RISING", hint: "growth vs own size" },
  { key: "hunts", label: "OVERTAKES", hint: "active chases, soonest first" },
];

function Lane({
  repo,
  pos,
  maxV,
  medianV,
  metric,
}: {
  repo: LaneRepo;
  pos: number;
  maxV: number;
  medianV: number;
  metric: "abs" | "rel";
}) {
  const C = usePalette();
  const color = dopplerTilt(repo.v / Math.max(medianV, 0.5), C);
  const W = 320;
  const len = Math.max(26, Math.sqrt(repo.v / Math.max(maxV, 1)) * (W - 14));
  return (
    <Link
      prefetch={false}
      href={`/r/${repo.r}`}
      className="group grid grid-cols-[2rem_1fr] items-center gap-x-3 gap-y-1 border-b border-grid/60 px-2 py-2.5 transition-colors hover:bg-accent/5 sm:grid-cols-[2.5rem_minmax(180px,1fr)_340px_auto]"
    >
      <span className="numeral text-data text-faint">{pos}</span>
      <span className="min-w-0">
        <span className="numeral block truncate text-data text-ink group-hover:text-accent">
          {shortName(repo.r)}
        </span>
        <span className="numeral block truncate text-micro text-faint">
          {fmtCompact(repo.s)} ★ · #{repo.rank}
          {repo.l ? ` · ${repo.l}` : ""}
          {repo.hunt ? (
            <span style={{ color }}> · overtakes {shortName(repo.hunt.victim)} in {repo.hunt.eta}</span>
          ) : null}
        </span>
      </span>
      <svg
        width={W}
        height={20}
        viewBox={`0 0 ${W} 20`}
        className="col-span-2 w-full sm:col-span-1 sm:w-[340px]"
        aria-hidden
      >
        <path
          d={`M ${len} 7.4 L ${len - len} 10 L ${len} 12.6 Z`}
          fill={color}
          opacity={0.4}
        />
        <path d={`M ${len - 1} 4.5 L ${len + 8} 10 L ${len - 1} 15.5 Z`} fill={color} />
      </svg>
      <span className="numeral hidden text-right text-data sm:block" style={{ color }}>
        {metric === "abs" ? `${fmt(Math.round(repo.v))}/day` : `+${repo.relPct.toFixed(1)}%/day`}
      </span>
    </Link>
  );
}

export default function VelocityBoard({
  absolute,
  relative,
  hunts,
  medianV,
}: {
  absolute: LaneRepo[];
  relative: LaneRepo[];
  hunts: HuntRow[];
  medianV: number;
}) {
  const C = usePalette();
  const [lens, setLens] = useState<Lens>("absolute");
  const maxAbs = absolute[0]?.v ?? 1;
  const maxRel = relative[0]?.v ?? 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {LENSES.map((l) => (
          <button
            key={l.key}
            onClick={() => setLens(l.key)}
            className={`numeral border px-3 py-1.5 text-micro tracking-[0.2em] transition-colors ${
              lens === l.key
                ? "border-accent/60 bg-accent/10 text-accent"
                : "border-grid text-dim hover:border-accent/40 hover:text-ink"
            }`}
          >
            {l.label}
          </button>
        ))}
        <span className="numeral ml-1 text-micro text-faint">
          {LENSES.find((l) => l.key === lens)?.hint}
        </span>
      </div>

      {lens !== "hunts" ? (
        <div className="hud px-2 py-1 sm:px-4">
          {(lens === "absolute" ? absolute : relative).map((repo, i) => (
            <Lane
              key={repo.r}
              repo={repo}
              pos={i + 1}
              maxV={lens === "absolute" ? maxAbs : maxRel}
              medianV={medianV}
              metric={lens === "absolute" ? "abs" : "rel"}
            />
          ))}
        </div>
      ) : (
        <div className="hud px-2 py-1 sm:px-4">
          {hunts.map((h, i) => (
            <Link
              key={`${h.hunter}-${h.victim}`}
              prefetch={false}
              href={`/r/${h.victim}`}
              className="group flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-grid/60 px-2 py-2.5 transition-colors hover:bg-accent/5"
            >
              <span className="numeral min-w-0 text-data">
                <span className="text-faint">{i + 1}</span>{" "}
                <span className="text-ink group-hover:text-accent">{shortName(h.hunter)}</span>
                <span className="text-dim"> overtakes </span>
                <span className="text-ink">{shortName(h.victim)}</span>
                <span className="text-dim"> (#{h.victimRank})</span>
              </span>
              <span className="numeral text-label">
                <span style={{ color: dopplerTilt(h.hunterV / Math.max(medianV, 0.5), C) }}>
                  {fmt(h.hunterV)}/day
                </span>
                <span className="text-dim"> · gap {fmt(h.gap)} · </span>
                <span className="text-accent">in {h.eta}</span>
              </span>
            </Link>
          ))}
          <p className="numeral px-2 py-2 text-micro text-faint">
            watch any of them live: the orange ship on the victim&apos;s chart is the hunter
          </p>
        </div>
      )}
    </div>
  );
}
