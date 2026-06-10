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
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ChartInputs, RouteRepo } from "@/lib/types";
import { usePalette } from "@/lib/usePalette";
import { fmt, fmtCompact, fmtEtaDays, etaDate, shortName } from "@/lib/format";
import { neighborEtas, type NeighborEta } from "@/lib/projections";
import { sound } from "@/lib/sound";

const W = 1200;
const H = 520;
const BAND_A_Y = 185; // headroom above keeps three label tiers clear of the header
const BAND_B_Y = 436;
const CLIP_BOTTOM = 330;

type ScanPlace = "above" | "below";

type Scan =
  | { kind: "neighbor"; n: NeighborEta; xPct: number; topPct: number; place: ScanPlace }
  | { kind: "route"; p: RouteRepo; xPct: number; topPct: number; place: ScanPlace };

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
  const C = usePalette();
  const router = useRouter();
  const [scan, setScan] = useState<Scan | null>(null);
  const [view, setView] = useState<{ lo: number; hi: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Origin marker: jumps between charts carry #from=owner/name (a hash, so
  // it never reaches the server and cannot bust the ISR cache). Falls back
  // to ?from= for old links.
  const [origin, setOrigin] = useState<{ r: string; s: number } | null>(null);
  useEffect(() => {
    const hashFrom = window.location.hash.match(/from=([^&]+)/)?.[1];
    const from = hashFrom
      ? decodeURIComponent(hashFrom)
      : new URLSearchParams(window.location.search).get("from");
    if (!from || from.toLowerCase() === inputs.repo.toLowerCase()) return;
    const hit =
      inputs.routeAll.find((p) => p.r.toLowerCase() === from.toLowerCase()) ??
      inputs.neighbors.find((n) => n.r.toLowerCase() === from.toLowerCase());
    if (hit) setOrigin({ r: hit.r, s: hit.s });
  }, [inputs.repo, inputs.routeAll, inputs.neighbors]);

  const { stars, rank, v7d: vOwn, apex, nowMs } = inputs;
  const repoName = shortName(inputs.repo);
  const nextMilestone = inputs.milestones[0] ?? null;

  // Warm the avatars of likely scan targets (neighbors + a handful of route
  // landmarks) during idle time, so the first hover card never shows a hole.
  // Images come straight from GitHub's CDN, which handles freshness itself.
  useEffect(() => {
    const owners = new Set<string>();
    for (const n of inputs.neighbors) owners.add(n.r.split("/")[0]);
    for (const p of inputs.routeDots.slice(0, 30)) owners.add(p.r.split("/")[0]);
    const warm = () => {
      for (const o of owners) {
        const img = new Image();
        img.src = `https://github.com/${o}.png?size=64`;
      }
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (idle) idle(warm);
    else setTimeout(warm, 1200);
  }, [inputs.neighbors, inputs.routeDots]);

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

  // Multi-depth star layers for the local system. Each layer drifts on its
  // own clock (slow time parallax) AND shifts with the pan position at its
  // depth factor, so panning reads as actually travelling through space.
  const starLayers = useMemo(() => {
    const mk = (seed: string, n: number, rA: number, rB: number, oA: number, oB: number) => {
      const rand = mulberry32(seedFrom(inputs.repo + seed));
      return Array.from({ length: n }, () => ({
        x: rand() * W,
        y: 54 + rand() * (CLIP_BOTTOM - 106),
        r: rA + rand() * (rB - rA),
        o: oA + rand() * (oB - oA),
      }));
    };
    return [
      { id: 1, f: 0.15, dur: 150, warp: false, stars: mk("::far", 40, 0.4, 0.8, 0.08, 0.2) },
      { id: 2, f: 0.45, dur: 80, warp: false, stars: mk("::mid", 55, 0.5, 1.0, 0.12, 0.3) },
      { id: 3, f: 0.9, dur: 0, warp: true, stars: mk("::near", 45, 0.7, 1.5, 0.18, 0.45) },
    ];
  }, [inputs.repo]);

  // FTL stretch while panning: armed by wheel events, relaxes shortly after.
  const [warping, setWarping] = useState(false);
  const warpTimer = useRef<number | null>(null);
  const armWarp = () => {
    setWarping(true);
    if (warpTimer.current !== null) clearTimeout(warpTimer.current);
    warpTimer.current = window.setTimeout(() => setWarping(false), 280);
  };

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

  // Route band: focus+context scale. Position follows log(1 + distance/K)
  // measured FROM OUR CURRENT STARS, so the stretch we are flying right now
  // gets the most room, compressing toward the core; as we overtake and our
  // star count grows, the map re-expands around us automatically.
  const dMax = Math.max(coreStars - stars, 10);
  const KD = dMax / 150;
  const bSpan = Math.log1p(dMax / KD);
  const bx = (s: number) => {
    const d = s - stars;
    if (d <= 0) {
      // small tail for things just behind us (origin marker, passed ships)
      return 40 - Math.min(10, (-d / Math.max(stars * 0.02, 1)) * 10);
    }
    return 40 + (Math.log1p(d / KD) / bSpan) * (W - 80);
  };
  const inWindow = (s: number) => {
    const l = log10(s);
    return l >= logLo - 0.0005 && l <= logHi + 0.0005;
  };

  // Parallax: pan position projected onto a fixed-scale world, per layer depth.
  const WORLD_PX = 6000;
  const worldX = ((logLo - bMin) / Math.max(bMax - bMin, 1e-6)) * WORLD_PX;
  const layerOffset = (f: number) => -((((worldX * f) % W) + W) % W);

  const geom = useRef({ defLo, defHi, bMin, bMax });
  geom.current = { defLo, defHi, bMin, bMax };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!e.ctrlKey && !horizontal && !e.shiftKey) return;
      e.preventDefault();
      if (e.ctrlKey) sound.zoomTick(e.deltaY < 0);
      else {
        sound.panWhoosh();
        armWarp();
      }
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

  // Tier assignment is aware of each label's real width, so long names like
  // "coding-interview-university" never overlap their neighbors. Neighbors
  // claim tiers first; whoever finds no free tier SHEDS its label and stays
  // as a bare dot (tier -1), with all its data still on hover.
  const tiers: number[] = new Array(items.length).fill(-1);
  {
    const rowsAbove: number[] = [-1e9, -1e9, -1e9]; // rightmost occupied edge per tier
    const rowsBelow: number[] = [-1e9, -1e9, -1e9];
    const order = items
      .map((_, i) => i)
      .sort((a, b) => {
        const pa = items[a].kind === "n" ? 0 : 1;
        const pb = items[b].kind === "n" ? 0 : 1;
        return pa - pb || ax(items[a].s) - ax(items[b].s);
      });
    for (const i of order) {
      const it = items[i];
      const x = ax(it.s);
      const name = trunc(shortName(it.kind === "n" ? it.n.r : it.p.r));
      const halfW = (Math.max(name.length, 12) * 6.2) / 2 + 8;
      const rows = it.kind === "n" && it.n.gap <= 0 ? rowsBelow : rowsAbove;
      let tier = 0;
      let fits = true;
      while (x - halfW < rows[tier] + 8) {
        if (tier >= rows.length - 1) {
          fits = false;
          break;
        }
        tier++;
      }
      if (!fits) continue; // sheds its label
      rows[tier] = Math.max(rows[tier], x + halfW);
      tiers[i] = tier;
    }
  }

  const visGates = inputs.milestones.filter((m) => inWindow(m.threshold));
  const isDefaultView = view === null;

  // High-route waypoints beyond the projection milestones (top 50/25/10),
  // read straight from the worldwide registry.
  const extraGates = useMemo(() => {
    if (!rank) return [] as { rank: number; threshold: number }[];
    return [50, 25, 10]
      .filter((rk) => rk < rank && inputs.routeAll.length >= rk)
      .map((rk) => ({ rank: rk, threshold: inputs.routeAll[rk - 1].s }));
  }, [rank, inputs.routeAll]);

  const vx0 = bx(Math.pow(10, logLo));
  const vx1 = bx(Math.pow(10, logHi));

  // chase target (pinned repo)
  const targetEntry = target
    ? etas.find((n) => n.r === target) ?? inputs.routeAll.find((p) => p.r === target) ?? null
    : null;
  const targetS = targetEntry?.s ?? null;

  // Node click: pin as chase target on the dashboard; on the explorer
  // (no pin handler) it warps to that repo's own system instead.
  const togglePin = (r: string) => {
    if (onPinTarget) {
      onPinTarget(target === r ? null : r);
      sound.hoverBlip();
    } else {
      router.push(`/r/${r}#from=${encodeURIComponent(inputs.repo)}`);
    }
  };

  // The scan card stays open while the pointer is inside it (grace delay),
  // so its actions are clickable.
  const closeTimer = useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setScan(null), 160);
  };
  const openScan = (s: Scan) => {
    cancelClose();
    sound.hoverBlip();
    setScan(s);
  };
  // Band A cards open DOWNWARD (the gap between bands has room and the
  // wrapper clips anything above its top edge); band B cards open upward.
  const bandATop = ((BAND_A_Y + 18) / H) * 100;
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

          {/* dust parallax: drift speed follows our own velocity */}
          <g
            className="dust-layer"
            style={{ animationDuration: `${Math.max(25, 110 - vOwn / 8)}s` }}
          >
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
            {/* multi-depth parallax: each layer shifts with the pan at its
                depth factor (travel) and drifts on its own clock (time).
                The near layer stretches into FTL streaks while panning. */}
            {starLayers.map((layer) => (
              <g
                key={layer.id}
                style={{
                  transform: `translateX(${layerOffset(layer.f).toFixed(1)}px)`,
                  transition: "transform 90ms linear",
                }}
              >
                <g
                  className="dust-stream"
                  style={{
                    animationDuration: `${(layer.dur || Math.max(10, 280 / Math.sqrt(Math.max(vOwn, 4)))).toFixed(1)}s`,
                  }}
                >
                  {[0, W, 2 * W].map((dx) => (
                    <g key={dx} transform={`translate(${dx} 0)`}>
                      {layer.stars.map((p, i) => (
                        <circle
                          key={i}
                          className={
                            layer.warp ? (warping ? "star-warp warping" : "star-warp") : undefined
                          }
                          cx={p.x}
                          cy={p.y}
                          r={p.r}
                          fill={C.speck}
                          opacity={p.o}
                        />
                      ))}
                    </g>
                  ))}
                </g>
              </g>
            ))}
            {visGates.map((m) => (
              <g key={m.rank}>
                <line
                  x1={ax(m.threshold)} y1={26} x2={ax(m.threshold)} y2={BAND_A_Y + 38}
                  stroke={C.accent} strokeWidth={1} strokeDasharray="2 4" opacity={0.7}
                />
                <text
                  x={Math.min(Math.max(ax(m.threshold), 130), W - 170)} y={18} fill={C.accent} fontSize={10}
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
                    openScan({ kind: "route", p, xPct: clampPct((ax(p.s) / W) * 100), topPct: bandATop, place: "below" })
                  }
                  onMouseLeave={scheduleClose}
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
                if (tiers[i] === -1) {
                  // label shed: bare interactive dot, data stays on hover
                  return (
                    <g
                      key={n.r}
                      className="nbr"
                      onMouseEnter={() =>
                        openScan({ kind: "neighbor", n, xPct: clampPct((x / W) * 100), topPct: bandATop, place: "below" })
                      }
                      onMouseLeave={scheduleClose}
                      onClick={() => togglePin(n.r)}
                    >
                      <circle cx={x} cy={BAND_A_Y} r={8} fill="transparent" />
                      {isTarget ? (
                        <circle cx={x} cy={BAND_A_Y} r={8} fill="none" stroke={C.accent} strokeWidth={1.2} />
                      ) : null}
                      <circle className="nbr-dot" cx={x} cy={BAND_A_Y} r={3.2} fill={color} opacity={isAhead ? 0.95 : 0.55} />
                    </g>
                  );
                }
                const tierY = isAhead
                  ? BAND_A_Y - 38 - tiers[i] * 34
                  : BAND_A_Y + 62 + tiers[i] * 30;
                const lineY1 = isAhead ? tierY + 8 : BAND_A_Y + 6;
                const lineY2 = isAhead ? BAND_A_Y - 5 : tierY - 20;
                return (
                  <g
                    key={n.r}
                    className="nbr"
                    onMouseEnter={() =>
                      openScan({ kind: "neighbor", n, xPct: clampPct((x / W) * 100), topPct: bandATop, place: "below" })
                    }
                    onMouseLeave={scheduleClose}
                    onClick={() => togglePin(n.r)}
                  >
                    <line x1={x} y1={lineY1} x2={x} y2={lineY2} stroke={C.grid} strokeWidth={1} />
                    {isTarget ? (
                      <circle cx={x} cy={BAND_A_Y} r={8} fill="none" stroke={C.accent} strokeWidth={1.2} />
                    ) : null}
                    <circle className="nbr-dot" cx={x} cy={BAND_A_Y} r={3.2} fill={color} opacity={isAhead ? 0.95 : 0.55} />
                    {Math.abs(n.v - vOwn) >= 1 ? (
                      <circle
                        className="vel-streak"
                        cx={x}
                        cy={BAND_A_Y}
                        r={1.3}
                        fill={n.receding ? C.warn : C.accent}
                        style={{
                          "--drift": `${(n.v - vOwn < 0 ? -1 : 1) * 16}px`,
                          "--dur": `${Math.max(1, 5.5 - Math.log10(Math.max(Math.abs(n.v - vOwn), 1)) * 1.6).toFixed(2)}s`,
                        } as React.CSSProperties}
                      />
                    ) : null}
                    <text className="nbr-name" x={x} y={tierY - 12} fill={isAhead ? C.ink : C.faint} fontSize={10}
                      textAnchor="middle">
                      {trunc(shortName(n.r))}
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
              if (tiers[i] === -1) {
                return (
                  <g
                    key={p.r}
                    className="nbr"
                    onMouseEnter={() =>
                      openScan({ kind: "route", p, xPct: clampPct((x / W) * 100), topPct: bandATop, place: "below" })
                    }
                    onMouseLeave={scheduleClose}
                    onClick={() => togglePin(p.r)}
                  >
                    <circle cx={x} cy={BAND_A_Y} r={8} fill="transparent" />
                    {isTarget ? (
                      <circle cx={x} cy={BAND_A_Y} r={8} fill="none" stroke={C.accent} strokeWidth={1.2} />
                    ) : null}
                    <circle className="nbr-dot" cx={x} cy={BAND_A_Y} r={1.6} fill={C.white} opacity={0.55} />
                  </g>
                );
              }
              const tierY = BAND_A_Y - 38 - tiers[i] * 34;
              return (
                <g
                  key={p.r}
                  className="nbr"
                  onMouseEnter={() =>
                    openScan({ kind: "route", p, xPct: clampPct((x / W) * 100), topPct: bandATop, place: "below" })
                  }
                  onMouseLeave={scheduleClose}
                  onClick={() => togglePin(p.r)}
                >
                  <line x1={x} y1={tierY + 8} x2={x} y2={BAND_A_Y - 5} stroke={C.grid} strokeWidth={1} />
                  {isTarget ? (
                    <circle cx={x} cy={BAND_A_Y} r={8} fill="none" stroke={C.accent} strokeWidth={1.2} />
                  ) : null}
                  <circle className="nbr-dot" cx={x} cy={BAND_A_Y} r={2.4} fill={C.white} opacity={0.8} />
                  <text className="nbr-name" x={x} y={tierY - 2} fill={C.ink} fontSize={10} textAnchor="middle">
                    {trunc(shortName(p.r))}
                  </text>
                  <text x={x} y={tierY + 10} fill={C.dim} fontSize={9} textAnchor="middle">
                    {fmtCompact(p.s)} · #{p.rank}
                  </text>
                </g>
              );
            })}

            {origin && inWindow(origin.s) ? (
              <g>
                <path
                  d={`M ${ax(origin.s)} ${BAND_A_Y - 7} L ${ax(origin.s) + 5} ${BAND_A_Y} L ${ax(origin.s)} ${BAND_A_Y + 7} L ${ax(origin.s) - 5} ${BAND_A_Y} Z`}
                  fill="none" stroke={C.accent} strokeWidth={1.3}
                />
                <text x={ax(origin.s) + 9} y={BAND_A_Y + 3.5} fill={C.accent} fontSize={9.5}
                  textAnchor="start" opacity={0.9}>
                  {trunc(shortName(origin.r))} · origin
                </text>
              </g>
            ) : null}

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
            distance scale, widest around you · every dot is a top 1000 repo · [ ] marks the window above
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
                openScan({ kind: "route", p, xPct: clampPct((bx(p.s) / W) * 100), topPct: bandBTop, place: "above" })
              }
              onMouseLeave={scheduleClose}
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

          {/* high-route waypoints (top 50/25/10), dimmer than projections */}
          {extraGates.map((m) => (
            <g key={`x${m.rank}`} opacity={0.6}>
              <circle cx={bx(m.threshold)} cy={BAND_B_Y} r={4} fill="none" stroke={C.accent}
                strokeWidth={1} opacity={0.7} />
              <text x={bx(m.threshold)} y={BAND_B_Y - 20} fill={C.dim} fontSize={9}
                textAnchor="middle">
                TOP {m.rank}
              </text>
              <text x={bx(m.threshold)} y={BAND_B_Y - 32} fill={C.faint} fontSize={8.5}
                textAnchor="middle">
                {fmtCompact(m.threshold)}
              </text>
            </g>
          ))}

          {/* HOME: this instance's tracked repo, always on the map */}
          {inputs.home ? (
            <g>
              <path
                d={`M ${bx(inputs.home.s)} ${BAND_B_Y - 7} L ${bx(inputs.home.s) + 5} ${BAND_B_Y + 5} L ${bx(inputs.home.s) - 5} ${BAND_B_Y + 5} Z`}
                fill="none" stroke={C.accent} strokeWidth={1.2}
              />
              <text x={bx(inputs.home.s)} y={BAND_B_Y + 64} fill={C.accent} fontSize={9}
                textAnchor="middle" opacity={0.9}>
                ⌂ {trunc(shortName(inputs.home.r))}
              </text>
            </g>
          ) : null}

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

          {origin ? (
            <g>
              <path
                d={`M ${bx(origin.s)} ${BAND_B_Y - 6} L ${bx(origin.s) + 4.5} ${BAND_B_Y} L ${bx(origin.s)} ${BAND_B_Y + 6} L ${bx(origin.s) - 4.5} ${BAND_B_Y} Z`}
                fill="none" stroke={C.accent} strokeWidth={1.2}
              />
              <text x={bx(origin.s)} y={BAND_B_Y + 52} fill={C.accent} fontSize={9}
                textAnchor="middle" opacity={0.85}>
                {trunc(shortName(origin.r))} · origin
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
            className="scan-card hud z-10 w-[250px] px-3 py-2.5"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{
              left: `${scan.xPct}%`,
              top: `${scan.topPct}%`,
              transform: scan.place === "above" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
              borderColor:
                scan.kind === "neighbor" && scan.n.receding
                  ? C.scanBorderWarn
                  : C.scanBorder,
            }}
          >
            <ScanContent scan={scan} ownV={vOwn} nowMs={nowMs} />
            <div className="mt-2 flex items-center gap-2 border-t border-grid pt-2">
              <Link
                prefetch
                href={`/r/${scan.kind === "neighbor" ? scan.n.r : scan.p.r}#from=${encodeURIComponent(inputs.repo)}`}
                className="numeral flex-1 border border-accent/40 px-2 py-1 text-center text-[9px] tracking-[0.18em] text-accent transition-colors hover:bg-accent/10"
              >
                OPEN SCAN
              </Link>
              {onPinTarget ? (
                <button
                  onClick={() => togglePin(scan.kind === "neighbor" ? scan.n.r : scan.p.r)}
                  className="numeral flex-1 border border-grid px-2 py-1 text-[9px] tracking-[0.18em] text-dim transition-colors hover:text-ink"
                >
                  {target === (scan.kind === "neighbor" ? scan.n.r : scan.p.r) ? "UNPIN" : "PIN TARGET"}
                </button>
              ) : null}
            </div>
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

function trunc(s: string): string {
  return s.length > 24 ? s.slice(0, 23) + "…" : s;
}

function clampPct(p: number): number {
  return Math.min(88, Math.max(12, p));
}

function fmtSignedGap(gap: number): string {
  const a = Math.abs(gap);
  const s = a >= 10_000 ? fmtCompact(a) : fmt(a);
  return (gap >= 0 ? "+" : "-") + s;
}
