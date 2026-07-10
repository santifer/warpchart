"use client";

// Mobile star chart: a true spatial ASCENT. The vertical axis is the real
// (log) star distance, so dense neighborhoods cluster and far ships float
// away, exactly like the horizontal chart. Star specks twinkle behind,
// FTL streaks climb past, every ship carries its Doppler color and a
// vertical comet tail (toward the core when we gain on it, toward us when
// it escapes), and labels shed to leader lines when space runs out: the
// dot always sits at its REAL position. Tap a ship to pin it (dashboard)
// or warp to it (explorer); the chevron opens its scan page.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RotateHint from "./RotateHint";
import BadgeSigil from "./BadgeSigil";
import type { ChartInputs } from "@/lib/types";
import type { Palette } from "@/lib/theme";
import { usePalette } from "@/lib/usePalette";
import { dopplerTilt } from "@/lib/doppler";
import { fmt, fmtCompact, fmtEtaDays, fmtEtaRange, shortName } from "@/lib/format";
import { neighborEtas, type NeighborEta } from "@/lib/projections";

const W = 390;
const AXIS_X = 30;
const LABEL_X = 46;
const PAD_TOP = 46;
const PAD_BOT = 40;
const MIN_GAP = 48; // label block spacing

function trunc(s: string): string {
  return s.length > 24 ? s.slice(0, 23) + "…" : s;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Same trail physics as the galactic chart: length proportional to the
// relative speed in OUR frame, passed ships at half scale unless they hunt
// us from behind (full length + thicker), siren pulse (closing = faster).
function dopplerFor(rel: number, isAhead: boolean, P: Palette) {
  const mag = Math.abs(1 - rel);
  const paced = mag <= 0.15;
  const closing = isAhead ? rel < 1 : rel > 1;
  const threat = !isAhead && rel > 1 && !paced;
  const color = dopplerTilt(rel, P);
  const base = paced ? 0 : 5 + Math.min(mag, 2.2) * 12;
  const tailLen = base * (!isAhead && !threat ? 0.5 : 1);
  // our frame, vertical: ships we gain on fall DOWN, their trail points UP
  const tailDir = rel < 1 ? -1 : 1;
  const durBase = Math.max(0.8, 2.6 - Math.min(mag, 2) * 0.8);
  const dur = closing ? durBase * 0.6 : durBase * 1.4;
  const girth = threat ? 2.4 : 1.6;
  return { color, tailLen, tailDir, dur, girth, threat };
}

export default function VerticalChart({
  inputs,
  target = null,
  onPinTarget,
  charted,
}: {
  inputs: ChartInputs;
  target?: string | null;
  onPinTarget?: (r: string | null) => void;
  // repos that have already been charted (a codex exists). Vignelli's transit
  // convention: a charted system is a SOLID dot, an uncharted one a HOLLOW
  // ring waiting to be filled. Undefined = everything solid (legacy callers).
  charted?: string[];
}) {
  const router = useRouter();
  const C = usePalette();
  const chartedSet = charted ? new Set(charted.map((r) => r.toLowerCase())) : null;

  // Per-node classification sigils (same cache-only map as the desktop chart),
  // so the mobile ascent also shows which systems carry a badge — not just the
  // hero. One fetch, looked up by lower-cased repo name.
  const [badgeMap, setBadgeMap] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let gone = false;
    fetch("/api/v1/badges")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!gone && j?.badges) setBadgeMap(j.badges);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, []);
  // a sigil placed to the RIGHT of a left-anchored node name (the mobile chart
  // has no room left of the dot column), vertically centred on the name
  const sigilRight = (repo: string, baselineY: number, name: string, fontSize: number) => {
    const k = badgeMap?.[repo.toLowerCase()];
    if (!k) return null;
    const sz = 16;
    const nameW = name.length * fontSize * 0.6; // numeral font is monospace
    return (
      <g transform={`translate(${(LABEL_X + nameW + 5).toFixed(1)}, ${(baselineY - sz / 2 - 4).toFixed(1)})`}>
        <BadgeSigil badgeKey={k} size={sz} />
      </g>
    );
  };
  const { stars, rank, v7d: vOwn, apex } = inputs;
  const etas = neighborEtas(inputs.neighbors, stars, vOwn);

  // Own trail vs the local traffic's median pace (same scale as neighbors).
  const vsSorted = inputs.neighbors.map((n) => n.v).filter((v) => v > 0).sort((a, b) => a - b);
  const medianV = vsSorted.length ? vsSorted[Math.floor(vsSorted.length / 2)] : 0;
  const shipExcess = vOwn / Math.max(medianV, 0.5) - 1;
  const shipTail = shipExcess <= 0.15 ? 0 : 5 + Math.min(shipExcess, 2.2) * 12;
  const shipDur = Math.max(0.8, 2.6 - Math.min(shipExcess, 2) * 0.8) * 0.7;
  const log10 = Math.log10;

  // Ranked ascent. The vertical axis is NOT raw log-stars (neighbors sit a
  // few hundred stars apart out of tens of thousands, so a pure star scale
  // crushes them into one pixel and the de-collision then spills "ahead"
  // labels below ME). Instead: order everyone by star count (most ahead at
  // the top, toward the core), drop ME in at its gap=0 slot, and space each
  // row by a CONSTANT floor plus a logarithmic bump for the REAL star gap.
  // Tiny gaps read as "right next door"; a thousand-star jump reads as
  // "farther" without the linear blow-out that would shove it off-screen.
  // Dots and labels share a row, so the order is always honest and nothing
  // collides: no leader lines, no labels stranded on the wrong side of ME.
  // keep the NEAREST neighbors (the rank-adjacent ones: #402, #401, #400…),
  // then render them with the largest gap at the top. Taking the 9 LARGEST
  // gaps instead dropped exactly the repos sitting between us and the next
  // gate, leaving the gate floating over empty space.
  const aheadAsc = etas.filter((n) => n.gap > 0).sort((a, b) => a.gap - b.gap).slice(0, 9);
  const aheadDesc = [...aheadAsc].sort((a, b) => b.gap - a.gap);
  const behindDesc = etas.filter((n) => n.gap <= 0).sort((a, b) => b.gap - a.gap).slice(0, 3);

  // T8 — the ONE most-active uncharted system in view emits a radio signal
  // (scarce on purpose: activity detected, come discover it). Charted set
  // unknown -> no signals.
  const signalRepo = chartedSet
    ? ([...aheadAsc, ...behindDesc]
        .filter((n) => !chartedSet.has(n.r.toLowerCase()) && n.v > 0)
        .sort((a, b) => b.v - a.v)[0]?.r ?? null)
    : null;

  type SeqNode = { me: boolean; n?: NeighborEta; s: number };
  const seq: SeqNode[] = [
    ...aheadDesc.map((n) => ({ me: false, n, s: n.s })),
    { me: true, s: stars },
    ...behindDesc.map((n) => ({ me: false, n, s: n.s })),
  ];

  const SEP_K = 13; // px of extra spacing per decade of star gap
  const ys: number[] = [];
  let cy = PAD_TOP + 30;
  for (let i = 0; i < seq.length; i++) {
    if (i > 0) {
      const d = Math.abs(seq[i - 1].s - seq[i].s);
      const meAdjacent = seq[i].me || seq[i - 1].me;
      cy += (meAdjacent ? MIN_GAP + 12 : MIN_GAP) + SEP_K * log10(1 + d);
    }
    ys.push(cy);
  }
  const H = cy + PAD_BOT + 24;

  type Row =
    | { me: true; s: number; y: number }
    | { me: false; n: NeighborEta; s: number; y: number };
  const rows: Row[] = seq.map((node, i) =>
    node.me
      ? { me: true as const, s: node.s, y: ys[i] }
      : { me: false as const, n: node.n!, s: node.s, y: ys[i] },
  );
  const meIdx = seq.findIndex((node) => node.me);
  const meY = ys[meIdx];
  const hiS = seq[0].s;
  const loS = seq[seq.length - 1].s;

  // gates fall BETWEEN two ranked rows (a doorway), interpolated by the log
  // of the real star gap so the threshold lands at its honest spot
  const yForStar = (s: number) => {
    if (s >= seq[0].s) return ys[0] - 22;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].s <= s) {
        const sHi = seq[i - 1].s;
        const sLo = seq[i].s;
        const f =
          (log10(sHi) - log10(Math.max(s, 1))) /
          Math.max(log10(sHi) - log10(Math.max(sLo, 1)), 1e-9);
        return ys[i - 1] + f * (ys[i] - ys[i - 1]);
      }
    }
    return ys[ys.length - 1] + 22;
  };

  // gate Y by RANK, not by a (possibly stale) star threshold. We are rank R;
  // the repo at rank N is the (R - N)-th neighbor ahead of us, so the TOP N
  // gate sits between it and the next one up: counting from us, exactly
  // (R - N) repos precede the gate. This makes "#403, so 4 systems before
  // the top-400 doorway" literally true. Falls back to the star position
  // when the rank-N repo is beyond the shown neighbors (far gates) or the
  // neighbors are not rank-contiguous (their stars must bracket the gate).
  const yOfShip = new Map<NeighborEta, number>();
  rows.forEach((row) => {
    if (!row.me) yOfShip.set(row.n, row.y);
  });
  const gateY = (m: { rank: number; threshold: number; at?: number | null }) => {
    const star = m.at ?? m.threshold;
    const k = rank ? rank - m.rank : -1; // repos between us and rank N (incl.)
    if (k >= 1 && k <= aheadAsc.length) {
      const below = aheadAsc[k - 1]; // the repo AT rank N (just under the gate)
      const above = aheadAsc[k]; // the repo at rank N-1 (just over the gate)
      const yBelow = yOfShip.get(below);
      // rank and stars must agree (contiguous neighbors): the rank-N repo's
      // stars should sit at/above the threshold, the next one higher still
      if (yBelow !== undefined && below.s >= star - 1) {
        const yAbove = above ? yOfShip.get(above) ?? yBelow - MIN_GAP : yBelow - MIN_GAP;
        return (yBelow + yAbove) / 2;
      }
    }
    return yForStar(star);
  };

  // backdrop: twinkling specks + climbing FTL streaks, seeded per repo
  const rand = mulberry32(seedFrom(inputs.repo + "::ascent"));
  const specks = Array.from({ length: 34 }, () => ({
    x: rand() * W,
    y: PAD_TOP + rand() * (H - PAD_TOP - PAD_BOT),
    r: rand() < 0.8 ? 0.7 : 1.2,
    o: 0.12 + rand() * 0.4,
    d: (rand() * 4).toFixed(2),
    dur: (2.8 + rand() * 2).toFixed(2),
  }));
  const streaks = Array.from({ length: 3 }, (_, i) => ({
    x: 60 + rand() * (W - 110),
    y: H - 60 - rand() * 80,
    len: 60 + rand() * 70,
    dur: (11 + rand() * 6).toFixed(1),
    delay: (i * 4.5 + rand() * 2).toFixed(1),
  }));

  const act = (r: string) => {
    if (onPinTarget) onPinTarget(target === r ? null : r);
    else router.push(`/r/${r}#from=${encodeURIComponent(inputs.repo)}`);
  };
  const open = (r: string) => router.push(`/r/${r}#from=${encodeURIComponent(inputs.repo)}`);

  const hiddenAbove = apex && rank ? Math.max(0, rank - aheadDesc.length - 1) : 0;

  return (
    <div className="flex flex-col gap-1">
      <RotateHint />
      {/* the core is light-years up: a compact heading instead of dead space */}
      <div className="flex items-baseline justify-between gap-2 px-1 pb-1">
        <span className="numeral text-label font-semibold text-star">
          ▲ GALACTIC CORE{apex ? ` · #1 ${trunc(shortName(apex.r))}` : ""}
        </span>
        <span className="numeral text-micro text-faint">
          {apex ? `${fmtCompact(apex.s)} ★ · ` : ""}
          {hiddenAbove > 0 ? `${fmt(hiddenAbove)} systems above` : "in range"}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Vertical ascent chart: your repository and its ranking neighbors at their real star distance"
      >
        {/* backdrop */}
        {specks.map((sp, i) => (
          <circle
            key={i}
            className="dust-tw"
            cx={sp.x}
            cy={sp.y}
            r={sp.r}
            fill={C.speck}
            opacity={sp.o}
            style={{ animationDelay: `${sp.d}s`, animationDuration: `${sp.dur}s` }}
          />
        ))}
        {streaks.map((st, i) => (
          <rect
            key={`st${i}`}
            className="asc-streak"
            x={st.x}
            y={st.y}
            width={1.3}
            height={st.len}
            rx={0.6}
            fill={C.accent}
            style={{ animationDuration: `${st.dur}s`, animationDelay: `${st.delay}s` }}
          />
        ))}

        {/* ascent axis */}
        <line x1={AXIS_X} y1={PAD_TOP - 18} x2={AXIS_X} y2={H - 14} stroke={C.grid} strokeWidth={1} />
        <path
          d={`M ${AXIS_X} ${PAD_TOP - 26} l -4.5 9 h 9 Z`}
          fill={C.accent}
          opacity={0.8}
        />

        {/* gates sit between rank N and rank N-1 (a doorway), positioned by
            RANK so exactly (R - N) systems precede the top-N line */}
        {inputs.milestones
          .filter((m) => (m.at ?? m.threshold) > loS && (m.at ?? m.threshold) < hiS)
          .map((m) => {
            const gy = gateY(m);
            // gate ETA, same model as the StatusBar headline ("top N in X"):
            // gap to the threshold over our v7d minus the threshold's drift.
            // Anchoring it ON the line ties that number to a spot on the climb,
            // so a nearer ship reading a longer eta (it sits further up, past
            // the gate) no longer looks like a contradiction.
            const gGap = Math.max(0, m.threshold - stars);
            const net = vOwn - (m.drift ?? 0);
            const gEta = gGap === 0 ? "crossed" : net > 0 ? `in ${fmtEtaDays(gGap / net)}` : null;
            return (
              <g key={m.rank}>
                <line
                  x1={14}
                  y1={gy}
                  x2={W - 14}
                  y2={gy}
                  stroke={C.accent}
                  strokeWidth={1}
                  strokeDasharray="2 5"
                  opacity={0.55}
                />
                <text x={W - 14} y={gy - 5} textAnchor="end" fontSize={11}
                  fill={C.accent} letterSpacing={1.5} className="numeral chart-anno">
                  TOP {m.rank} · {fmtCompact(m.threshold)} ★{gEta ? ` · ${gEta}` : ""}
                </text>
              </g>
            );
          })}

        {/* ships: dot and label share one row Y (no leader lines needed,
            the ranked spacing already keeps them apart and in order) */}
        {rows.map((row, i) => {
          if (row.me) return null;
          const n = row.n;
          const y = row.y;
          const isAhead = n.gap > 0;
          const dop = dopplerFor(n.v / Math.max(vOwn, 1), isAhead, C);
          const isTarget = target === n.r;
          const uncharted = chartedSet ? !chartedSet.has(n.r.toLowerCase()) : false;
          const signal = uncharted && n.r === signalRepo;
          return (
            <g
              key={n.r}
              className="asc-row"
              onClick={() => act(n.r)}
              style={{ cursor: "pointer", animation: `ship-in 0.5s ease-out ${Math.min(i, 14) * 50}ms both` }}
            >
              <title>
                {signal
                  ? `${n.r} · ◌ activity detected — open to chart this system`
                  : uncharted
                    ? `${n.r} · uncharted system — open to chart it`
                    : n.r}
              </title>
              <rect x={0} y={y - 20} width={W - 40} height={44} fill="transparent" />
              {dop.tailLen > 0 ? (
                <>
                  <path
                    d={`M ${AXIS_X - dop.girth} ${y} L ${AXIS_X} ${y + dop.tailDir * dop.tailLen} L ${AXIS_X + dop.girth} ${y} Z`}
                    fill={dop.color}
                    opacity={dop.threat ? 0.5 : isAhead ? 0.32 : 0.2}
                  />
                  <circle
                    className="vel-streak-y"
                    cx={AXIS_X}
                    cy={y}
                    r={1.2}
                    fill={dop.color}
                    style={{
                      "--drift": `${dop.tailDir * (dop.tailLen + 5)}px`,
                      "--dur": `${dop.dur.toFixed(2)}s`,
                    } as React.CSSProperties}
                  />
                </>
              ) : null}
              {isTarget ? (
                <circle cx={AXIS_X} cy={y} r={8} fill="none" stroke={C.accent} strokeWidth={1.2} />
              ) : null}
              {signal ? (
                <circle className="sig-ping" cx={AXIS_X} cy={y} r={4} fill="none" stroke={C.accent} strokeWidth={1.1} />
              ) : null}
              {uncharted ? (
                // Vignelli: a system not yet charted reads as a hollow ring
                <circle
                  cx={AXIS_X}
                  cy={y}
                  r={3.7}
                  fill="none"
                  stroke={dop.color}
                  strokeWidth={1.3}
                  opacity={isAhead ? 0.85 : 0.5}
                />
              ) : (
                <circle cx={AXIS_X} cy={y} r={3.4} fill={dop.color} opacity={isAhead ? 0.95 : 0.55} />
              )}
              <text x={LABEL_X} y={y - 2} fontSize={13}
                fill={isAhead || n.catchDays !== null ? C.ink : C.faint} className="numeral chart-anno">
                {trunc(shortName(n.r))}
              </text>
              {sigilRight(n.r, y - 2, trunc(shortName(n.r)), 13)}
              <text x={LABEL_X} y={y + 13} fontSize={11} fill={C.dim} className="numeral chart-anno">
                {isAhead ? `+${fmtCompact(n.gap)}` : fmtCompact(n.gap)} · {Math.round(n.v)}/d ·{" "}
                <tspan
                  fill={
                    n.catchDays !== null && !isAhead
                      ? dop.color
                      : !isAhead
                        ? C.faint
                        : n.receding
                          ? C.warn
                          : C.accent
                  }
                >
                  {n.catchDays !== null && !isAhead
                    ? `catches you in ${fmtEtaRange(n.catchDays, n.etaRange)}`
                    : !isAhead
                      ? "passed"
                      : n.receding
                        ? "pulling away"
                        : `eta ${fmtEtaRange(n.etaDays, n.etaRange)}`}
                </tspan>
                {signal ? <tspan fill={C.accent}> · ◌</tspan> : null}
              </text>
              {/* 44px finger-sized hit area: the bare glyph was 15x14px and
                  thumb taps landed on the row (pin) instead of navigating */}
              <g
                onClick={(e) => {
                  e.stopPropagation();
                  open(n.r);
                }}
                style={{ cursor: "pointer" }}
              >
                <rect x={W - 48} y={y - 17} width={44} height={44} fill="transparent" />
                <text x={W - 16} y={y + 5} textAnchor="end" fontSize={13} fill={C.dim} className="numeral chart-anno">
                  →
                </text>
              </g>
            </g>
          );
        })}

        {/* our ship */}
        <g>
          {/* own trail: velocity vs the local traffic's median, pointing
              down the climb; same scale as every neighbor tail */}
          {shipTail > 0 ? (
            <>
              <path
                d={`M ${AXIS_X - 2.2} ${meY} L ${AXIS_X} ${meY + shipTail} L ${AXIS_X + 2.2} ${meY} Z`}
                fill={C.white}
                opacity={0.5}
              />
              {[0, 1].map((k) => (
                <circle
                  key={k}
                  className="vel-streak-y"
                  cx={AXIS_X}
                  cy={meY}
                  r={1.3}
                  fill={C.white}
                  style={{
                    "--drift": `${shipTail + 6}px`,
                    "--dur": `${shipDur.toFixed(2)}s`,
                    animationDelay: k === 1 ? `${(shipDur / 2).toFixed(2)}s` : undefined,
                  } as React.CSSProperties}
                />
              ))}
            </>
          ) : null}
          <circle cx={AXIS_X} cy={meY} r={15} fill="url(#vShip)" opacity={0.55} />
          <circle className="ship-ping" cx={AXIS_X} cy={meY} r={12} fill="none" stroke={C.accent} strokeWidth={1} />
          <path
            d={`M ${AXIS_X} ${meY - 7} l 5.5 11 h -11 Z`}
            fill={C.white}
            className="core-glow"
          />
          <text x={LABEL_X} y={meY - 1} fontSize={14} fontWeight={700} fill={C.white} className="numeral chart-anno">
            {trunc(shortName(inputs.repo))}
          </text>
          {sigilRight(inputs.repo, meY - 1, trunc(shortName(inputs.repo)), 14)}
          <text x={LABEL_X} y={meY + 15} fontSize={11.5} fill={C.accent} className="numeral chart-anno">
            {fmt(stars)} ★{rank ? ` · #${fmt(rank)}` : ""} · {fmt(Math.round(vOwn))}/day
          </text>
        </g>

        <defs>
          <radialGradient id="vShip">
            <stop offset="0%" stopColor={C.accent} stopOpacity="0.9" />
            <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>

      <span className="numeral px-1 text-micro text-faint">
        ranked ascent · even spacing, log bump for the star gap · doppler tails: up = you gain, down = it escapes
      </span>
    </div>
  );
}
