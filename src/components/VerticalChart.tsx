"use client";

// Mobile star chart: a true spatial ASCENT. The vertical axis is the real
// (log) star distance, so dense neighborhoods cluster and far ships float
// away, exactly like the horizontal chart. Star specks twinkle behind,
// FTL streaks climb past, every ship carries its Doppler color and a
// vertical comet tail (toward the core when we gain on it, toward us when
// it escapes), and labels shed to leader lines when space runs out: the
// dot always sits at its REAL position. Tap a ship to pin it (dashboard)
// or warp to it (explorer); the chevron opens its scan page.
import { useRouter } from "next/navigation";
import type { ChartInputs } from "@/lib/types";
import type { Palette } from "@/lib/theme";
import { usePalette } from "@/lib/usePalette";
import { dopplerTilt } from "@/lib/doppler";
import { fmt, fmtCompact, fmtEtaDays, shortName } from "@/lib/format";
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
}: {
  inputs: ChartInputs;
  target?: string | null;
  onPinTarget?: (r: string | null) => void;
}) {
  const router = useRouter();
  const C = usePalette();
  const { stars, rank, v7d: vOwn, apex } = inputs;
  const etas = neighborEtas(inputs.neighbors, stars, vOwn);
  const ahead = etas.filter((n) => n.gap > 0).sort((a, b) => a.gap - b.gap).slice(0, 9);
  const behind = etas.filter((n) => n.gap <= 0).sort((a, b) => b.gap - a.gap).slice(0, 3);

  // density-adaptive vertical window, same spirit as the horizontal chart
  const aheadSpread = ahead.length
    ? Math.max(ahead[ahead.length - 1].s - stars, stars * 0.004)
    : stars * 0.05;
  const gate = inputs.milestones[0]?.threshold ?? null;
  let hiS = stars + aheadSpread * 1.25;
  if (gate !== null && gate <= stars + aheadSpread * 2.6) hiS = Math.max(hiS, gate * 1.012);
  const loS = behind.length
    ? Math.min(...behind.map((n) => n.s)) * 0.997
    : stars * 0.988;

  const ships: NeighborEta[] = [...ahead, ...behind];
  const H = PAD_TOP + PAD_BOT + Math.max(420, (ships.length + 2) * MIN_GAP);
  const log10 = Math.log10;
  const yFor = (s: number) => {
    const t = (log10(Math.max(s, 1)) - log10(loS)) / Math.max(log10(hiS) - log10(loS), 1e-6);
    return H - PAD_BOT - t * (H - PAD_TOP - PAD_BOT);
  };

  // labels keep MIN_GAP via leader lines; dots stay at their real y. Our
  // own ship's block is reserved space: neighbor labels flow around it
  // (above when there is room, otherwise below).
  const meY = yFor(stars);
  const ME_TOP = meY - 32;
  const ME_BOT = meY + 36;
  const placed = ships
    .map((n) => ({ n, y: yFor(n.s) }))
    .sort((a, b) => a.y - b.y);
  let cursor = PAD_TOP + 8;
  const rows = placed.map((p) => {
    let labelY = Math.max(p.y, cursor);
    if (labelY > ME_TOP - 16 && labelY < ME_BOT) {
      labelY = cursor <= ME_TOP - 16 ? ME_TOP - 16 : ME_BOT;
    }
    cursor = labelY + MIN_GAP;
    return { ...p, labelY };
  });

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

  const hiddenAbove = apex && rank ? Math.max(0, rank - ahead.length - 1) : 0;

  return (
    <div className="flex flex-col gap-1">
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

        {/* gates at their real altitude */}
        {inputs.milestones
          .filter((m) => m.threshold > loS && m.threshold < hiS)
          .map((m) => (
            <g key={m.rank}>
              <line
                x1={14}
                y1={yFor(m.threshold)}
                x2={W - 14}
                y2={yFor(m.threshold)}
                stroke={C.accent}
                strokeWidth={1}
                strokeDasharray="2 5"
                opacity={0.55}
              />
              <text x={W - 14} y={yFor(m.threshold) - 5} textAnchor="end" fontSize={11}
                fill={C.accent} letterSpacing={1.5} className="numeral">
                TOP {m.rank} · {fmtCompact(m.threshold)} ★
              </text>
            </g>
          ))}

        {/* ships */}
        {rows.map(({ n, y, labelY }, i) => {
          const isAhead = n.gap > 0;
          const dop = dopplerFor(n.v / Math.max(vOwn, 1), isAhead, C);
          const isTarget = target === n.r;
          const shifted = Math.abs(labelY - y) > 6;
          return (
            <g
              key={n.r}
              className="asc-row"
              onClick={() => act(n.r)}
              style={{ cursor: "pointer", animation: `ship-in 0.5s ease-out ${Math.min(i, 14) * 50}ms both` }}
            >
              <rect x={0} y={labelY - 20} width={W - 40} height={44} fill="transparent" />
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
              <circle cx={AXIS_X} cy={y} r={3.4} fill={dop.color} opacity={isAhead ? 0.95 : 0.55} />
              {shifted ? (
                <line x1={AXIS_X + 5} y1={y} x2={LABEL_X - 3} y2={labelY - 4} stroke={C.grid} strokeWidth={1} />
              ) : null}
              <text x={LABEL_X} y={labelY - 2} fontSize={13}
                fill={isAhead || n.catchDays !== null ? C.ink : C.faint} className="numeral">
                {trunc(shortName(n.r))}
              </text>
              <text x={LABEL_X} y={labelY + 13} fontSize={11} fill={C.dim} className="numeral">
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
                    ? `catches you in ${fmtEtaDays(n.catchDays)}`
                    : !isAhead
                      ? "passed"
                      : n.receding
                        ? "pulling away"
                        : `eta ${fmtEtaDays(n.etaDays)}`}
                </tspan>
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
                <rect x={W - 48} y={labelY - 17} width={44} height={44} fill="transparent" />
                <text x={W - 16} y={labelY + 5} textAnchor="end" fontSize={13} fill={C.dim} className="numeral">
                  →
                </text>
              </g>
            </g>
          );
        })}

        {/* our ship */}
        <g>
          <circle cx={AXIS_X} cy={meY} r={15} fill="url(#vShip)" opacity={0.55} />
          <circle className="ship-ping" cx={AXIS_X} cy={meY} r={12} fill="none" stroke={C.accent} strokeWidth={1} />
          <path
            d={`M ${AXIS_X} ${meY - 7} l 5.5 11 h -11 Z`}
            fill={C.accent}
            className="core-glow"
          />
          <text x={LABEL_X} y={meY - 1} fontSize={14} fontWeight={700} fill={C.white} className="numeral">
            {trunc(shortName(inputs.repo))}
          </text>
          <text x={LABEL_X} y={meY + 15} fontSize={11.5} fill={C.accent} className="numeral">
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
        ascent view · real log distance · doppler tails: up = you gain, down = it escapes
      </span>
    </div>
  );
}
