"use client";

// The signature panel: a star chart in two bands.
//   Band A (LOCAL SYSTEM): linear zoom around our position. Neighbor repos as
//   stars, the next milestone as a jump gate. The old "highway", as a map.
//   Band B (ROUTE TO THE CORE): log-scale route from here to the worldwide #1
//   repo (the galactic core), with every milestone as a waypoint.
import { useMemo } from "react";
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import { C } from "@/lib/theme";
import { fmt, fmtCompact, fmtEtaDays, shortName } from "@/lib/format";
import { neighborEtas } from "@/lib/projections";

const W = 1200;
const H = 470;
const BAND_A_Y = 150;
const BAND_B_Y = 388;

// Deterministic PRNG so the decorative dust is stable across server/client.
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

export default function GalacticChart({ bundle }: { bundle: DashboardBundle }) {
  const live = useLive();
  const stars = live.stars;
  const vOwn = bundle.v7d;
  const repoName = bundle.meta ? shortName(bundle.meta.repo) : "this repo";
  const apex = bundle.apex;
  const nextMilestone = bundle.milestones[0] ?? null;

  const etas = useMemo(
    () => neighborEtas(live.neighbors, stars, vOwn),
    [live.neighbors, stars, vOwn]
  );

  const dust = useMemo(() => {
    const rand = mulberry32(seedFrom(bundle.meta?.repo ?? "mission-control"));
    return Array.from({ length: 90 }, () => ({
      x: rand() * W,
      y: rand() * H,
      r: rand() < 0.85 ? 0.7 : 1.3,
      o: 0.12 + rand() * 0.45,
    }));
  }, [bundle.meta?.repo]);

  // ---------- Band A: local system (linear) ----------
  const ahead = etas.filter((n) => n.gap > 0).sort((a, b) => a.gap - b.gap).slice(0, 10);
  const behind = etas.filter((n) => n.gap <= 0).sort((a, b) => b.gap - a.gap).slice(0, 3);
  const gateX = nextMilestone?.threshold ?? null;

  const aMin = Math.min(stars, ...behind.map((n) => n.s)) - 80;
  const aMax = Math.max(gateX ?? 0, ...ahead.map((n) => n.s), stars + 400) + 250;
  const ax = (s: number) => 40 + ((s - aMin) / (aMax - aMin)) * (W - 80);

  // Label tiers to avoid collisions: repos ahead of us stack above the band
  // line, repos already passed stack below it (keeps the header area clean).
  const labeled = [...behind, ...ahead].sort((a, b) => a.s - b.s);
  const tiers: number[] = [];
  {
    const lastAbove: number[] = [-1e9, -1e9, -1e9];
    const lastBelow: number[] = [-1e9, -1e9, -1e9];
    for (const n of labeled) {
      const x = ax(n.s);
      const rows = n.gap > 0 ? lastAbove : lastBelow;
      let tier = 0;
      while (tier < rows.length - 1 && x - rows[tier] < 118) tier++;
      rows[tier] = x;
      tiers.push(tier);
    }
  }

  // ---------- Band B: route to the core (log) ----------
  const coreStars = apex?.s ?? Math.max(stars * 8, 400_000);
  const bMin = Math.log10(stars * 0.96);
  const bMax = Math.log10(coreStars * 1.06);
  const bx = (s: number) => 40 + ((Math.log10(s) - bMin) / (bMax - bMin)) * (W - 80);

  const waypoints = [...bundle.milestones].sort((a, b) => b.rank - a.rank);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[760px]"
        role="img"
        aria-label="Star chart: local ranking neighbors and the route to the worldwide number one repository"
      >
        <defs>
          <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={C.accent} stopOpacity="0.55" />
            <stop offset="78%" stopColor={C.accent} stopOpacity="0.25" />
            <stop offset="100%" stopColor={C.white} stopOpacity="0.9" />
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
        </defs>

        {/* decorative dust */}
        {dust.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={C.white} opacity={d.o * 0.5} />
        ))}

        {/* ============ BAND A: LOCAL SYSTEM ============ */}
        <text x={40} y={30} fill={C.dim} fontSize={10} letterSpacing={4} className="font-display">
          LOCAL SYSTEM
        </text>
        <text x={40} y={46} fill={C.faint} fontSize={9} fontFamily="monospace">
          linear scale · stars · closing speed vs our v7d {fmt(Math.round(vOwn))}/day
        </text>

        <line x1={40} y1={BAND_A_Y} x2={W - 40} y2={BAND_A_Y} stroke={C.grid} strokeWidth={1} />

        {/* jump gate: next milestone threshold */}
        {gateX !== null && nextMilestone ? (
          <g>
            <line
              x1={ax(gateX)} y1={BAND_A_Y - 124} x2={ax(gateX)} y2={BAND_A_Y + 38}
              stroke={C.accent} strokeWidth={1} strokeDasharray="2 4" opacity={0.7}
            />
            <text
              x={Math.min(ax(gateX), W - 170)} y={BAND_A_Y - 132} fill={C.accent} fontSize={10}
              textAnchor="middle" letterSpacing={2}
            >
              TOP {nextMilestone.rank} GATE · {fmt(nextMilestone.threshold)}
            </text>
          </g>
        ) : null}

        {/* neighbors */}
        {labeled.map((n, i) => {
          const x = ax(n.s);
          const isAhead = n.gap > 0;
          const color = !isAhead ? C.faint : n.receding ? C.warn : C.accent;
          const tierY = isAhead
            ? BAND_A_Y - 38 - tiers[i] * 34
            : BAND_A_Y + 62 + tiers[i] * 36;
          const lineY1 = isAhead ? tierY + 8 : BAND_A_Y + 6;
          const lineY2 = isAhead ? BAND_A_Y - 5 : tierY - 20;
          return (
            <g key={n.r}>
              <line x1={x} y1={lineY1} x2={x} y2={lineY2} stroke={C.grid} strokeWidth={1} />
              <circle cx={x} cy={BAND_A_Y} r={3.2} fill={color} opacity={isAhead ? 0.95 : 0.55} />
              <text x={x} y={tierY - 12} fill={isAhead ? C.ink : C.faint} fontSize={10}
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
        })}

        {/* our ship */}
        <g>
          <circle cx={ax(stars)} cy={BAND_A_Y} r={16} fill="url(#shipGrad)" opacity={0.5} />
          <path
            d={`M ${ax(stars)} ${BAND_A_Y - 7} L ${ax(stars) + 6} ${BAND_A_Y + 5} L ${ax(stars) - 6} ${BAND_A_Y + 5} Z`}
            fill={C.accent}
            className="core-glow"
          />
          <text x={ax(stars)} y={BAND_A_Y + 24} fill={C.white} fontSize={10.5}
            textAnchor="middle" fontFamily="monospace" fontWeight={700}>
            {repoName}
          </text>
          <text x={ax(stars)} y={BAND_A_Y + 37} fill={C.accent} fontSize={9.5}
            textAnchor="middle" fontFamily="monospace">
            {fmt(stars)} ★
          </text>
        </g>

        {/* ============ connector ============ */}
        <line
          x1={ax(stars)} y1={BAND_A_Y + 46} x2={bx(stars)} y2={BAND_B_Y - 56}
          stroke={C.grid} strokeWidth={1} strokeDasharray="2 5"
        />

        {/* ============ BAND B: ROUTE TO THE CORE ============ */}
        <text x={40} y={BAND_B_Y - 88} fill={C.dim} fontSize={10} letterSpacing={4} className="font-display">
          ROUTE TO THE CORE
        </text>
        <text x={40} y={BAND_B_Y - 72} fill={C.faint} fontSize={9} fontFamily="monospace">
          log scale · destination: worldwide rank 1
        </text>

        <line x1={40} y1={BAND_B_Y} x2={W - 40} y2={BAND_B_Y} stroke="url(#routeGrad)" strokeWidth={1.2} />

        {/* milestone waypoints */}
        {waypoints.map((m) => (
          <g key={m.rank}>
            <circle cx={bx(m.threshold)} cy={BAND_B_Y} r={5} fill="none" stroke={C.accent}
              strokeWidth={1} opacity={0.85} />
            <circle cx={bx(m.threshold)} cy={BAND_B_Y} r={1.6} fill={C.accent} />
            <text x={bx(m.threshold)} y={BAND_B_Y - 16} fill={C.ink} fontSize={9.5}
              textAnchor="middle" fontFamily="monospace">
              TOP {m.rank}
            </text>
            <text x={bx(m.threshold)} y={BAND_B_Y + 20} fill={C.dim} fontSize={9}
              textAnchor="middle" fontFamily="monospace">
              {fmtCompact(m.threshold)}
            </text>
          </g>
        ))}

        {/* the galactic core */}
        {apex ? (
          <g className="core-glow">
            <circle cx={bx(coreStars)} cy={BAND_B_Y} r={26} fill="url(#coreGrad)" />
            <circle cx={bx(coreStars)} cy={BAND_B_Y} r={3.4} fill={C.white} />
            <text x={bx(coreStars)} y={BAND_B_Y - 36} fill={C.white} fontSize={10}
              textAnchor="end" fontFamily="monospace" fontWeight={700}>
              GALACTIC CORE
            </text>
            <text x={bx(coreStars)} y={BAND_B_Y - 24} fill={C.dim} fontSize={9}
              textAnchor="end" fontFamily="monospace">
              #1 {shortName(apex.r)} · {fmtCompact(apex.s)} ★
            </text>
          </g>
        ) : null}

        {/* our ship on the route */}
        <g>
          <path
            d={`M ${bx(stars) - 5} ${BAND_B_Y - 6} L ${bx(stars) + 7} ${BAND_B_Y} L ${bx(stars) - 5} ${BAND_B_Y + 6} Z`}
            fill={C.accent}
            className="core-glow"
          />
          <text x={Math.max(40, bx(stars) - 6)} y={BAND_B_Y + 44} fill={C.white} fontSize={9.5}
            textAnchor="start">
            you are here{live.rank ? ` · #${live.rank}` : ""}
          </text>
        </g>
      </svg>
    </div>
  );
}

function fmtSignedGap(gap: number): string {
  const a = Math.abs(gap);
  const s = a >= 10_000 ? fmtCompact(a) : fmt(a);
  return (gap >= 0 ? "+" : "-") + s;
}
