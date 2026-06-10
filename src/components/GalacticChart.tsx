"use client";

// The signature panel: a star chart in two bands.
//   Band A (LOCAL SYSTEM): a pannable zoom window over the route. Horizontal
//   wheel / trackpad pans it, ctrl+wheel (pinch) zooms, double-click resets.
//   Band B (ROUTE TO THE CORE): the full log-scale route from the current
//   position to the worldwide #1 repo, with a [ ] viewport bracket mirroring
//   what band A shows.
// Fully decoupled from the live layer: everything arrives via ChartInputs,
// so both the tenant dashboard and the /r/ explorer can render it.
// Clicking a repo pins it as chase target (when onPinTarget is provided).
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartInputs, RouteRepo } from "@/lib/types";
import { C } from "@/lib/theme";
import { fmt, fmtCompact, fmtEtaDays, etaDate, shortName } from "@/lib/format";
import { neighborEtas, type NeighborEta } from "@/lib/projections";
import { sound } from "@/lib/sound";

const W = 1200;
const H = 470;
const BAND_A_Y = 150;
const BAND_B_Y = 388;
const CLIP_BOTTOM = 292;

type Scan =
  | { kind: "neighbor"; n: NeighborEta; xPct: number; topPct: number }
  | { kind: "route"; p: RouteRepo; xPct: number; topPct: number };

type AItem =
  | { kind: "n"; s: number; n: NeighborEta }
  | { kind: "d"; s: number; p: RouteRepo };

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

const log10 = Math.log10;

export default function GalacticChart({
  inputs,
  target = null,
  onPinTarget,
}: {
  inputs: ChartInputs;
  target?: string | null;
  onPinTarget?: (r: string | null) => void;
}) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [view, setView] = useState<{ lo: number; hi: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const { stars, rank, v7d: vOwn, apex, nowMs } = inputs;
  const repoName = shortName(inputs.repo);
  const nextMilestone = inputs.milestones[0] ?? null;

  const etas = useMemo(
    () => neighborEtas(inputs.neighbors, stars, vOwn),
    [inputs.neighbors, stars, vOwn]
  );

  const dust = useMemo(() => {
    const rand = mulberry32(seedFrom(inputs.repo));
    return Array.from({ length: 90 }, () => ({
      x: rand() * W,
      y: rand() * H,
      r: rand() < 0.85 ? 0.7 : 1.3,
      o: 0.12 + rand() * 0.45,
    }));
  }, [inputs.repo]);

  // ---------- geometry ----------
  const ahead = etas.filter((n) => n.gap > 0).sort((a, b) => a.gap - b.gap).slice(0, 10);
  const behind = etas.filter((n) => n.gap <= 0).sort((a, b) => b.gap - a.gap).slice(0, 3);
  const gateX = nextMilestone?.threshold ?? null;

  const aMinDefault = Math.max(1, Math.min(stars, ...behind.map((n) => n.s)) - 80);
  const aMaxDefault = Math.max(gateX ?? 0, ...ahead.map((n) => n.s), stars + 400) + 250;

  const coreStars = apex?.s ?? Math.max(stars * 8, 400_000);
  const bMin = log10(Math.min(stars * 0.96, aMinDefault));
  const bMax = log10(coreStars * 1.06);

  const defLo = Math.max(bMin, log10(aMinDefault));
  const defHi = Math.min(bMax, log10(aMaxDefault));
  const logLo = view?.lo ?? defLo;
  const logHi = view?.hi ?? defHi;
  const span = logHi - logLo;

  const ax = (s: number) => 40 + ((log10(s) - logLo) / span) * (W - 80);
  const bx = (s: number) => 40 + ((log10(s) - bMin) / (bMax - bMin)) * (W - 80);
  const inWindow = (s: number) => {
    const l = log10(s);
    return l >= logLo - 0.0005 && l <= logHi + 0.0005;
  };

  const geom = useRef({ defLo, defHi, bMin, bMax });
  geom.current = { defLo, defHi, bMin, bMax };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!e.ctrlKey && !horizontal && !e.shiftKey) return;
      e.preventDefault();
      sound.panWhoosh();
      const g = geom.current;
      setView((v) => {
        const lo = v?.lo ?? g.defLo;
        const hi = v?.hi ?? g.defHi;
        const sp = hi - lo;
        if (e.ctrlKey) {
          const c = (lo + hi) / 2;
          let ns = sp * (1 + e.deltaY / 250);
          ns = Math.min(Math.max(ns, 0.004), g.bMax - g.bMin);
          let nLo = c - ns / 2;
          nLo = Math.min(Math.max(nLo, g.bMin), g.bMax - ns);
          return { lo: nLo, hi: nLo + ns };
        }
        const d = horizontal ? e.deltaX : e.deltaY;
        const shift = (d / 600) * sp * 4;
        const nLo = Math.min(Math.max(lo + shift, g.bMin), g.bMax - sp);
        return { lo: nLo, hi: nLo + sp };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---------- band A content ----------
  const neighborNames = useMemo(() => new Set(etas.map((n) => n.r)), [etas]);
  const visNbrs = [...behind, ...ahead].filter((n) => inWindow(n.s));
  const visDots = inputs.routeAll.filter(
    (p) => inWindow(p.s) && !neighborNames.has(p.r) && p.r !== apex?.r && p.r !== inputs.repo
  );

  const LABEL_MAX = 13;
  const dotBudget = Math.max(0, LABEL_MAX - visNbrs.length);
  const dotStep = dotBudget > 0 ? Math.max(1, Math.ceil(visDots.length / dotBudget)) : Infinity;
  const labeledDotSet = new Set(
    visDots.filter((_, i) => i % dotStep === 0).slice(0, dotBudget).map((p) => p.r)
  );

  const items: AItem[] = [
    ...visNbrs.map((n): AItem => ({ kind: "n", s: n.s, n })),
    ...visDots.filter((p) => labeledDotSet.has(p.r)).map((p): AItem => ({ kind: "d", s: p.s, p })),
  ].sort((a, b) => a.s - b.s);

  const tiers: number[] = [];
  {
    const lastAbove: number[] = [-1e9, -1e9, -1e9];
    const lastBelow: number[] = [-1e9, -1e9, -1e9];
    for (const it of items) {
      const x = ax(it.s);
      const below = it.kind === "n" && it.n.gap <= 0;
      const rows = below ? lastBelow : lastAbove;
      let tier = 0;
      while (tier < rows.length - 1 && x - rows[tier] < 118) tier++;
      rows[tier] = x;
      tiers.push(tier);
    }
  }

  const visGates = inputs.milestones.filter((m) => inWindow(m.threshold));
  const isDefaultView = view === null;

  const vx0 = bx(Math.pow(10, logLo));
  const vx1 = bx(Math.pow(10, logHi));

  // chase target (pinned repo)
  const targetEntry = target
    ? etas.find((n) => n.r === target) ?? inputs.routeAll.find((p) => p.r === target) ?? null
    : null;
  const targetS = targetEntry?.s ?? null;

  const togglePin = (r: string) => {
    if (!onPinTarget) return;
    onPinTarget(target === r ? null : r);
    sound.hoverBlip();
  };

  const openScan = (s: Scan) => {
    sound.hoverBlip();
    setScan(s);
  };
  const bandATop = ((BAND_A_Y - 12) / H) * 100;
  const bandBTop = ((BAND_B_Y - 14) / H) * 100;

  return (
    <div className="w-full overflow-x-auto">
      <div className="relative min-w-[760px]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Star chart: pannable local system window and the route to the worldwide number one repository"
          onDoubleClick={() => setView(null)}
        >
          <defs>
            <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={C.accent} stopOpacity="0.4" />
              <stop offset="78%" stopColor={C.accent} stopOpacity="0.18" />
              <stop offset="100%" stopColor={C.white} stopOpacity="0.7" />
            </linearGradient>
            <radialGradient id="coreGrad">
              <stop offset="0%" stopColor={C.white} stopOpacity="1" />
              <stop offset="35%" stopColor={C.accent} stopOpacity="0.7" />
              <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
            </radialGradient>
            <radialGradient id="shipGrad">
              <stop offset="0%" stopColor={C.accent} stopOpacity="0.9" />
              <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
            </radialGradient>
            <clipPath id="bandAClip">
              <rect x={28} y={0} width={W - 56} height={CLIP_BOTTOM} />
            </clipPath>
          </defs>

          <g className="dust-layer">
            {dust.map((d, i) => (
              <circle
                key={i}
                cx={d.x}
                cy={d.y}
                r={d.r}
                fill={C.white}
                opacity={d.o * 0.5}
                className={i % 3 === 0 ? "dust-tw" : undefined}
              />
            ))}
          </g>

          {/* ============ BAND A: LOCAL SYSTEM (pannable window) ============ */}
          <text x={40} y={30} fill={C.dim} fontSize={10} letterSpacing={4} className="font-display">
            LOCAL SYSTEM
          </text>
          <text x={40} y={46} fill={C.faint} fontSize={9}>
            zoom window over the route · scroll sideways to pan · pinch to zoom · double-click to reset
          </text>
          {!isDefaultView ? (
            <text x={W - 40} y={30} fill={C.accent} fontSize={9} textAnchor="end" opacity={0.8}>
              window {fmtCompact(Math.round(Math.pow(10, logLo)))} .. {fmtCompact(Math.round(Math.pow(10, logHi)))} ★
            </text>
          ) : null}

          <line x1={40} y1={BAND_A_Y} x2={W - 40} y2={BAND_A_Y} stroke={C.grid} strokeWidth={1} />

          <g clipPath="url(#bandAClip)">
            {visGates.map((m) => (
              <g key={m.rank}>
                <line
                  x1={ax(m.threshold)} y1={BAND_A_Y - 124} x2={ax(m.threshold)} y2={BAND_A_Y + 38}
                  stroke={C.accent} strokeWidth={1} strokeDasharray="2 4" opacity={0.7}
                />
                <text
                  x={Math.min(ax(m.threshold), W - 170)} y={BAND_A_Y - 132} fill={C.accent} fontSize={10}
                  textAnchor="middle" letterSpacing={2}
                >
                  TOP {m.rank} GATE · {fmt(m.threshold)}
                </text>
              </g>
            ))}

            {visDots
              .filter((p) => !labeledDotSet.has(p.r))
              .map((p) => (
                <g
                  key={p.r}
                  className="nbr"
                  onMouseEnter={() =>
                    openScan({ kind: "route", p, xPct: clampPct((ax(p.s) / W) * 100), topPct: bandATop })
                  }
                  onMouseLeave={() => setScan(null)}
                  onClick={() => togglePin(p.r)}
                >
                  <circle cx={ax(p.s)} cy={BAND_A_Y} r={8} fill="transparent" />
                  <circle className="nbr-dot" cx={ax(p.s)} cy={BAND_A_Y} r={1.6}
                    fill={C.white} opacity={0.55} />
                </g>
              ))}

            {items.map((it, i) => {
              const x = ax(it.s);
              const isTarget = target !== null && (it.kind === "n" ? it.n.r : it.p.r) === target;
              if (it.kind === "n") {
                const n = it.n;
                const isAhead = n.gap > 0;
                const color = !isAhead ? C.faint : n.receding ? C.warn : C.accent;
                const tierY = isAhead
                  ? BAND_A_Y - 38 - tiers[i] * 34
                  : BAND_A_Y + 62 + tiers[i] * 36;
                const lineY1 = isAhead ? tierY + 8 : BAND_A_Y + 6;
                const lineY2 = isAhead ? BAND_A_Y - 5 : tierY - 20;
                return (
                  <g
                    key={n.r}
                    className="nbr"
                    onMouseEnter={() =>
                      openScan({ kind: "neighbor", n, xPct: clampPct((x / W) * 100), topPct: bandATop })
                    }
                    onMouseLeave={() => setScan(null)}
                    onClick={() => togglePin(n.r)}
                  >
                    <line x1={x} y1={lineY1} x2={x} y2={lineY2} stroke={C.grid} strokeWidth={1} />
                    {isTarget ? (
                      <circle cx={x} cy={BAND_A_Y} r={8} fill="none" stroke={C.accent} strokeWidth={1.2} />
                    ) : null}
                    <circle className="nbr-dot" cx={x} cy={BAND_A_Y} r={3.2} fill={color} opacity={isAhead ? 0.95 : 0.55} />
                    <text className="nbr-name" x={x} y={tierY - 12} fill={isAhead ? C.ink : C.faint} fontSize={10}
                      textAnchor="middle">
                      {shortName(n.r)}
                    </text>
                    <text x={x} y={tierY} fill={C.dim} fontSize={9} textAnchor="middle">
                      {fmtSignedGap(n.gap)} · {Math.round(n.v)}/d
                    </text>
                    <text x={x} y={tierY + 11} fontSize={9} textAnchor="middle"
                      fill={!isAhead ? C.faint : n.receding ? C.warn : C.accent}>
                      {!isAhead ? "passed" : n.receding ? "receding" : `eta ${fmtEtaDays(n.etaDays)}`}
                    </text>
                  </g>
                );
              }
              const p = it.p;
              const tierY = BAND_A_Y - 38 - tiers[i] * 34;
              return (
                <g
                  key={p.r}
                  className="nbr"
                  onMouseEnter={() =>
                    openScan({ kind: "route", p, xPct: clampPct((x / W) * 100), topPct: bandATop })
                  }
                  onMouseLeave={() => setScan(null)}
                  onClick={() => togglePin(p.r)}
                >
                  <line x1={x} y1={tierY + 8} x2={x} y2={BAND_A_Y - 5} stroke={C.grid} strokeWidth={1} />
                  {isTarget ? (
                    <circle cx={x} cy={BAND_A_Y} r={8} fill="none" stroke={C.accent} strokeWidth={1.2} />
                  ) : null}
                  <circle className="nbr-dot" cx={x} cy={BAND_A_Y} r={2.4} fill={C.white} opacity={0.8} />
                  <text className="nbr-name" x={x} y={tierY - 2} fill={C.ink} fontSize={10} textAnchor="middle">
                    {shortName(p.r)}
                  </text>
                  <text x={x} y={tierY + 10} fill={C.dim} fontSize={9} textAnchor="middle">
                    {fmtCompact(p.s)} · #{p.rank}
                  </text>
                </g>
              );
            })}

            {apex && inWindow(coreStars) ? (
              <g className="core-glow">
                <circle cx={ax(coreStars)} cy={BAND_A_Y} r={30} fill="url(#coreGrad)" />
                <circle cx={ax(coreStars)} cy={BAND_A_Y} r={4} fill={C.white} />
                <text x={ax(coreStars)} y={BAND_A_Y - 44} fill={C.white} fontSize={10}
                  textAnchor="middle" fontWeight={700}>
                  GALACTIC CORE · #1 {shortName(apex.r)}
                </text>
              </g>
            ) : null}

            {inWindow(stars) ? (
              <g>
                <circle cx={ax(stars)} cy={BAND_A_Y} r={16} fill="url(#shipGrad)" opacity={0.5} />
                <circle className="ship-ping" cx={ax(stars)} cy={BAND_A_Y} r={13}
                  fill="none" stroke={C.accent} strokeWidth={1} />
                <path
                  d={`M ${ax(stars)} ${BAND_A_Y - 7} L ${ax(stars) + 6} ${BAND_A_Y + 5} L ${ax(stars) - 6} ${BAND_A_Y + 5} Z`}
                  fill={C.accent}
                  className="core-glow"
                />
                <text x={ax(stars)} y={BAND_A_Y + 24} fill={C.white} fontSize={10.5}
                  textAnchor="middle" fontWeight={700}>
                  {repoName}
                </text>
                <text x={ax(stars)} y={BAND_A_Y + 37} fill={C.accent} fontSize={9.5}
                  textAnchor="middle">
                  {fmt(stars)} ★
                </text>
              </g>
            ) : null}
          </g>

          {/* viewport connectors */}
          <line x1={40} y1={CLIP_BOTTOM} x2={vx0} y2={BAND_B_Y - 15}
            stroke={C.grid} strokeWidth={1} strokeDasharray="3 5" opacity={0.8} />
          <line x1={W - 40} y1={CLIP_BOTTOM} x2={vx1} y2={BAND_B_Y - 15}
            stroke={C.grid} strokeWidth={1} strokeDasharray="3 5" opacity={0.8} />

          {/* ============ BAND B: ROUTE TO THE CORE ============ */}
          <text x={40} y={BAND_B_Y - 88} fill={C.dim} fontSize={10} letterSpacing={4} className="font-display">
            ROUTE TO THE CORE
          </text>
          <text x={40} y={BAND_B_Y - 72} fill={C.faint} fontSize={9}>
            log scale · every dot is a worldwide top 1000 repo · [ ] marks the window above
          </text>

          <line x1={40} y1={BAND_B_Y} x2={W - 40} y2={BAND_B_Y} stroke="url(#routeGrad)" strokeWidth={0.5} />
          <line className="route-flow" x1={40} y1={BAND_B_Y} x2={W - 40} y2={BAND_B_Y}
            stroke={C.accent} strokeWidth={1.4} opacity={0.5} />

          <g>
            <rect x={vx0} y={BAND_B_Y - 13} width={Math.max(vx1 - vx0, 2)} height={26}
              fill={C.accent} opacity={0.07} />
            <path d={`M ${vx0 + 5} ${BAND_B_Y - 13} H ${vx0} V ${BAND_B_Y + 13} H ${vx0 + 5}`}
              stroke={C.accent} fill="none" strokeWidth={1.2} />
            <path d={`M ${vx1 - 5} ${BAND_B_Y - 13} H ${vx1} V ${BAND_B_Y + 13} H ${vx1 - 5}`}
              stroke={C.accent} fill="none" strokeWidth={1.2} />
          </g>

          {/* chase trajectory to the pinned target */}
          {targetS !== null ? (
            <g>
              <path
                d={`M ${bx(stars)} ${BAND_B_Y} Q ${(bx(stars) + bx(targetS)) / 2} ${BAND_B_Y - 36} ${bx(targetS)} ${BAND_B_Y}`}
                stroke={C.accent} fill="none" strokeWidth={1} strokeDasharray="3 4" opacity={0.65}
              />
              <circle className="ship-ping" cx={bx(targetS)} cy={BAND_B_Y} r={7}
                fill="none" stroke={C.accent} strokeWidth={1.2} />
            </g>
          ) : null}

          {inputs.routeDots.map((p) => (
            <g
              key={p.r}
              className="nbr"
              onMouseEnter={() =>
                openScan({ kind: "route", p, xPct: clampPct((bx(p.s) / W) * 100), topPct: bandBTop })
              }
              onMouseLeave={() => setScan(null)}
              onClick={() => togglePin(p.r)}
            >
              <circle cx={bx(p.s)} cy={BAND_B_Y} r={9} fill="transparent" />
              <circle className="nbr-dot" cx={bx(p.s)} cy={BAND_B_Y} r={1.4}
                fill={C.white} opacity={0.4 + (p.rank % 4) * 0.12} />
            </g>
          ))}

          {inputs.routeLandmarks
            .filter((p) => Math.abs(bx(p.s) - bx(stars)) > 150)
            .map((p, i) => (
              <g key={p.r}>
                <line x1={bx(p.s)} y1={BAND_B_Y + 6} x2={bx(p.s)} y2={BAND_B_Y + 26 + (i % 2) * 13}
                  stroke={C.grid} strokeWidth={1} />
                <text x={bx(p.s)} y={BAND_B_Y + 38 + (i % 2) * 13} fill={C.dim} fontSize={9}
                  textAnchor="middle">
                  {shortName(p.r)} · {fmtCompact(p.s)}
                </text>
              </g>
            ))}

          {[...inputs.milestones].sort((a, b) => b.rank - a.rank).map((m) => (
            <g key={m.rank}>
              <circle cx={bx(m.threshold)} cy={BAND_B_Y} r={5} fill="none" stroke={C.accent}
                strokeWidth={1} opacity={0.85} />
              <circle cx={bx(m.threshold)} cy={BAND_B_Y} r={1.6} fill={C.accent} />
              <text x={bx(m.threshold)} y={BAND_B_Y - 20} fill={C.ink} fontSize={9.5}
                textAnchor="middle">
                TOP {m.rank}
              </text>
              <text x={bx(m.threshold)} y={BAND_B_Y - 32} fill={C.faint} fontSize={8.5}
                textAnchor="middle">
                {fmtCompact(m.threshold)}
              </text>
            </g>
          ))}

          {apex ? (
            <g className="core-glow">
              <circle cx={bx(coreStars)} cy={BAND_B_Y} r={26} fill="url(#coreGrad)" />
              <circle cx={bx(coreStars)} cy={BAND_B_Y} r={3.4} fill={C.white} />
              <text x={bx(coreStars)} y={BAND_B_Y - 36} fill={C.white} fontSize={10}
                textAnchor="end" fontWeight={700}>
                GALACTIC CORE
              </text>
              <text x={bx(coreStars)} y={BAND_B_Y - 24} fill={C.dim} fontSize={9}
                textAnchor="end">
                #1 {shortName(apex.r)} · {fmtCompact(apex.s)} ★
              </text>
            </g>
          ) : null}

          <g>
            <path
              d={`M ${bx(stars) - 5} ${BAND_B_Y - 6} L ${bx(stars) + 7} ${BAND_B_Y} L ${bx(stars) - 5} ${BAND_B_Y + 6} Z`}
              fill={C.accent}
              className="core-glow"
            />
            <text x={Math.max(40, bx(stars) - 6)} y={BAND_B_Y + 22} fill={C.white} fontSize={9.5}
              textAnchor="start">
              you are here{rank ? ` · #${rank}` : ""}
            </text>
          </g>
        </svg>

        {scan ? (
          <div
            className="scan-card hud pointer-events-none z-10 w-[250px] px-3 py-2.5"
            style={{
              left: `${scan.xPct}%`,
              top: `${scan.topPct}%`,
              transform: "translate(-50%, -100%)",
              borderColor:
                scan.kind === "neighbor" && scan.n.receding
                  ? "rgba(242, 163, 60, 0.5)"
                  : "rgba(83, 214, 232, 0.45)",
            }}
          >
            <ScanContent scan={scan} ownV={vOwn} nowMs={nowMs} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ScanContent({ scan, ownV, nowMs }: { scan: Scan; ownV: number; nowMs: number }) {
  const full = scan.kind === "neighbor" ? scan.n.r : scan.p.r;
  const owner = full.split("/")[0];
  const desc = scan.kind === "neighbor" ? scan.n.d : scan.p.d;
  const lang = scan.kind === "neighbor" ? scan.n.l : scan.p.l;
  const status =
    scan.kind === "route"
      ? `RANK #${scan.p.rank}`
      : scan.n.gap <= 0
        ? "PASSED"
        : scan.n.receding
          ? "RECEDING"
          : "TARGET";
  const statusColor =
    scan.kind === "neighbor" && scan.n.receding ? "text-warn" : "text-accent";

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-[8px] tracking-[0.3em] text-dim">SCAN</span>
        <span className={`numeral text-[9px] tracking-[0.15em] ${statusColor}`}>{status}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://github.com/${owner}.png?size=64`}
          alt=""
          width={26}
          height={26}
          className="h-[26px] w-[26px] border border-grid"
        />
        <div className="min-w-0">
          <div className="numeral truncate text-[11px] font-semibold text-star">{full}</div>
          {lang ? <div className="numeral text-[9px] text-dim">{lang}</div> : null}
        </div>
      </div>
      {desc ? (
        <p className="mt-1.5 line-clamp-2 text-[10px] font-light leading-snug text-dim">{desc}</p>
      ) : null}
      <div className="numeral mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-grid pt-2 text-[10px]">
        <Row k="stars" v={fmt(scan.kind === "neighbor" ? scan.n.s : scan.p.s)} />
        {scan.kind === "neighbor" ? (
          <>
            <Row k="velocity" v={`${Math.round(scan.n.v)}/day`} />
            <Row k="gap" v={fmtSignedGap(scan.n.gap)} />
            <Row k="closing" v={`${scan.n.closing >= 0 ? "+" : ""}${Math.round(scan.n.closing)}/day`} />
            <Row
              k="overtake"
              v={
                scan.n.gap <= 0
                  ? "done"
                  : scan.n.etaDays !== null
                    ? `${fmtEtaDays(scan.n.etaDays)} · ${etaDate(scan.n.etaDays, new Date(nowMs)) ?? ""}`
                    : "out of reach"
              }
            />
            <Row k="our v7d" v={`${Math.round(ownV)}/day`} />
          </>
        ) : null}
      </div>
      <div className="numeral mt-1.5 text-[8px] tracking-[0.1em] text-faint">
        click to pin as chase target
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-faint">{k}</span>
      <span className="text-ink">{v}</span>
    </div>
  );
}

function clampPct(p: number): number {
  return Math.min(88, Math.max(12, p));
}

function fmtSignedGap(gap: number): string {
  const a = Math.abs(gap);
  const s = a >= 10_000 ? fmtCompact(a) : fmt(a);
  return (gap >= 0 ? "+" : "-") + s;
}
