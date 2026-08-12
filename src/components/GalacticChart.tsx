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
import BadgeSigil from "./BadgeSigil";
import type { ChartInputs, RouteRepo } from "@/lib/types";
import type { Palette } from "@/lib/theme";
import { usePalette } from "@/lib/usePalette";
import { dopplerTilt } from "@/lib/doppler";
import { fmt, fmtCompact, fmtEtaDays, fmtEtaRange, etaDate, shortName } from "@/lib/format";
import { neighborEtas, type NeighborEta } from "@/lib/projections";
import { sound } from "@/lib/sound";
import { ghAvatar } from "@/lib/avatar";

const BASE_W = 1200;
// Panel geometry; the fullscreen COMMAND DECK swaps in a taller AND wider
// canvas (real room measured from the screen, not scaled pixels) inside
// the component.
const BASE_H = 520;
const BASE_BAND_A_Y = 200; // headroom above keeps three label tiers clear of the header
const BASE_BAND_B_Y = 436;
const BASE_CLIP_BOTTOM = 345;

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

// Doppler reading of a repo's growth velocity RELATIVE to ours (rel = v/vOwn).
// Hue carries the side (blueshift = we gain on it, redshift = it outruns us);
// the comet tail is its motion trail in OUR reference frame: length is
// PROPORTIONAL to the relative speed (sweeping past a near-stalled repo
// leaves a long trail; flying in formation leaves none). Ships already
// passed render at half scale: attention follows the chase ahead, EXCEPT a
// hunter closing from behind, which keeps full length plus a thicker tail.
// Particle pulse is the siren: closing = higher frequency, receding = lower.
function dopplerFor(rel: number, isAhead: boolean, P: Palette) {
  const mag = Math.abs(1 - rel);
  const paced = mag <= 0.15;
  const closing = isAhead ? rel < 1 : rel > 1; // the gap is shrinking
  const threat = !isAhead && rel > 1 && !paced; // hunted from behind
  const color = dopplerTilt(rel, P);
  const base = paced ? 0 : 6 + Math.min(mag, 2.2) * 14;
  const tailLen = base * (!isAhead && !threat ? 0.5 : 1);
  const tailDir = rel < 1 ? 1 : -1;
  const durBase = Math.max(0.8, 2.6 - Math.min(mag, 2) * 0.8);
  const dur = closing ? durBase * 0.6 : durBase * 1.4;
  const girth = threat ? 2.6 : 1.7;
  return { color, tailLen, tailDir, dur, girth, threat };
}

function tailPath(x: number, y: number, len: number, dir: number, girth = 1.7): string {
  return `M ${x} ${y - girth} L ${x + dir * len} ${y} L ${x} ${y + girth} Z`;
}

export default function GalacticChart({
  inputs: ssrInputs,
  target = null,
  onPinTarget,
  liveLocals = false,
  deck = false,
  deckW,
  fitW,
  charted,
}: {
  inputs: ChartInputs;
  target?: string | null;
  onPinTarget?: (r: string | null) => void;
  // repos already charted (a codex exists). Vignelli transit convention:
  // charted = solid dot, uncharted = hollow ring. Undefined = all solid.
  charted?: string[];
  // Explorer pages opt in: poll the shared per-scene anchor so fast locals
  // move with REAL minute-fresh data. The tenant dashboard already gets
  // live neighbors from its own polling, so it never sets this.
  liveLocals?: boolean;
  // Fullscreen COMMAND DECK: taller canvas, smaller type, more label
  // tiers, and the context dots scatter into a 2D star system.
  deck?: boolean;
  // Deck canvas width, measured by the deck from its real screen hole so
  // ultrawide monitors get MORE MAP (wider scale, more label room) instead
  // of dead side bands. ViewBox units ~= screen pixels at deck scale.
  deckW?: number;
  // Same idea for wide inline showcases (landing spotlight): the measured
  // container width becomes the canvas width, so type stays at design size
  // and wide monitors get more map instead of giant letters.
  fitW?: number;
}) {
  // The deck trades the panel's fixed aspect for the screen's real room:
  // labels get two extra tiers, the local band breathes, and type stays at
  // UI size (the canvas matches the screen, so 1 unit ~= 1px).
  const W = deck
    ? Math.min(Math.max(Math.round(deckW ?? 1680), 1200), 2600)
    : fitW
      ? Math.min(Math.max(Math.round(fitW), 1200), 2400)
      : BASE_W;
  const H = deck ? 740 : BASE_H;
  const BAND_A_Y = deck ? 300 : BASE_BAND_A_Y;
  const CLIP_BOTTOM = deck ? 556 : BASE_CLIP_BOTTOM;
  const BAND_B_Y = deck ? 654 : BASE_BAND_B_Y;
  // Label scale. In deck mode the canvas width varies a lot with the hero's
  // aspect; tie fs to W so on-screen label size stays roughly constant (a wide
  // hero would otherwise shrink the text to unreadable). fs also drives the
  // collision spacing, so the label room scales with it too.
  const fs = deck ? Math.min(1.7, Math.max(0.95, W / 1750)) : 1;

  const C = usePalette();
  const router = useRouter();
  const [scan, setScan] = useState<Scan | null>(null);
  const [view, setView] = useState<{ lo: number; hi: number } | null>(null);
  // AUTO-ZOOM: on load, tighten the default frame until the nearest labelled
  // neighbours read clearly (a dense system fills the screen instead of crowding
  // the centre). Suspended while the viewer pans (view != null). Toggleable.
  const [autoZoom, setAutoZoom] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setAutoZoom(localStorage.getItem("mc_autozoom") !== "off"); } catch { /* private mode */ }
  }, []);
  const toggleAutoZoom = () =>
    setAutoZoom((v) => {
      const nv = !v;
      try { localStorage.setItem("mc_autozoom", nv ? "on" : "off"); } catch { /* private mode */ }
      return nv;
    });
  const svgRef = useRef<SVGSVGElement | null>(null);

  // REAL-TIME ANCHOR (hot scenes only): re-sync every local ship's exact
  // star count once a minute. One edge-cached response is shared by every
  // viewer of the same scene, so cost does not scale with audience.
  const [liveAnchor, setLiveAnchor] = useState<{ ts: number; stars: Record<string, number> } | null>(null);
  // the hero's primary classification (badge), fetched from the public API so its
  // sigil can ride next to the origin node's name in the star chart.
  const [mainClass, setMainClass] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    fetch(`/api/v1/repo?repo=${encodeURIComponent(ssrInputs.repo)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const list: { key: string; kind: string }[] = j?.classifications ?? [];
        const c = list.find((x) => x.kind === "class") ?? list[0];
        if (!gone && c) setMainClass(c.key);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [ssrInputs.repo]);
  // Per-node classifications: ONE cache-only fetch returns the primary badge
  // key of every classified repo in the registry, so EACH labelled node in the
  // chart can wear its sigil — not just the hero. Badges cluster toward the
  // core (the top-100 is dense with MAIN SEQUENCE / BLUE GIANT), so panning
  // inward lights the route up; the local desert at mid-rank stays bare, which
  // is the honest signal that the hero is the only anomaly there.
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
  const sceneHot =
    Math.max(ssrInputs.v7d, ...ssrInputs.neighbors.map((n) => n.v || 0)) >= 300;
  useEffect(() => {
    if (!liveLocals || !sceneHot) return;
    let gone = false;
    const repos = [ssrInputs.repo, ...ssrInputs.neighbors.map((n) => n.r)]
      .slice(0, 30)
      .sort() // normalized order = one cache entry per scene
      .join(",");
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/live/locals?repos=${encodeURIComponent(repos)}`);
        if (!res.ok) return;
        const j = await res.json();
        if (!gone && j?.stars) setLiveAnchor({ ts: j.ts ?? Date.now(), stars: j.stars });
      } catch {
        /* next tick */
      }
    };
    const warm = window.setTimeout(tick, 1500); // let the page settle first
    const id = window.setInterval(tick, 60_000);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      gone = true;
      window.clearTimeout(warm);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [liveLocals, sceneHot, ssrInputs.repo, ssrInputs.neighbors]);

  // Stars only ever climb here: an older cache entry must never drag a
  // ship backwards. Re-anchoring also resets nowMs, which re-zeroes the
  // drift clock below.
  const inputs = useMemo(() => {
    if (!liveAnchor) return ssrInputs;
    const fresh = (r: string, s: number) => Math.max(s, liveAnchor.stars[r.toLowerCase()] ?? 0);
    return {
      ...ssrInputs,
      stars: fresh(ssrInputs.repo, ssrInputs.stars),
      nowMs: liveAnchor.ts,
      neighbors: ssrInputs.neighbors.map((n) => {
        const s = fresh(n.r, n.s);
        return s === n.s ? n : { ...n, s };
      }),
    };
  }, [ssrInputs, liveAnchor]);

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
    // prefer the LIVE neighbor entry (exact current stars) over the daily
    // route registry, so the marker lands on the right pixel
    const hit =
      inputs.neighbors.find((n) => n.r.toLowerCase() === from.toLowerCase()) ??
      inputs.routeAll.find((p) => p.r.toLowerCase() === from.toLowerCase());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hit) setOrigin({ r: hit.r, s: hit.s });
  }, [inputs.repo, inputs.routeAll, inputs.neighbors]);

  const { stars, rank, v7d: vOwn, apex, nowMs } = inputs;
  const chartedSet = charted ? new Set(charted.map((r) => r.toLowerCase())) : null;
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
        img.src = ghAvatar(o, 64);
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

  // Our own trail: real velocity measured against the local traffic's
  // median pace, on the SAME length scale as every neighbor tail. Flying
  // in formation (or slower) leaves no trail; outrunning the band streaks.
  const { shipTail, shipDur } = useMemo(() => {
    const vs = inputs.neighbors.map((n) => n.v).filter((v) => v > 0).sort((a, b) => a - b);
    const median = vs.length ? vs[Math.floor(vs.length / 2)] : 0;
    const rel = vOwn / Math.max(median, 0.5);
    const excess = rel - 1;
    const tail = excess <= 0.15 ? 0 : 6 + Math.min(excess, 2.2) * 14;
    const dur = Math.max(0.8, 2.6 - Math.min(excess, 2) * 0.8) * 0.7;
    return { shipTail: tail, shipDur: dur };
  }, [inputs.neighbors, vOwn]);

  // Registry-diff velocity colors the WHOLE galaxy: every routed dot gets a
  // doppler hue (and a short static tail in the local band) at zero API
  // cost. Static fills only: animated particles stay reserved for the live
  // neighbor band, so a thousand dots cost nothing at runtime.
  const routeDotColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of inputs.routeAll) {
      if (p.v != null) m.set(p.r, dopplerTilt(p.v / Math.max(vOwn, 1), C));
    }
    return m;
  }, [inputs.routeAll, vOwn, C]);
  const dotTail = (v: number | null | undefined) => {
    if (v == null) return null;
    const rel = v / Math.max(vOwn, 1);
    const mag = Math.abs(1 - rel);
    if (mag <= 0.15) return null;
    // half scale: route dots are context, not the chase
    return { len: (6 + Math.min(mag, 2.2) * 14) * 0.5, dir: rel < 1 ? 1 : -1 };
  };

  // Golden pulsar: every REAL star (post-sync increments of the live count)
  // fires an expanding ring on our ship. The first jump after load is the
  // backlog catching up with the bundle, so it stays quiet.
  const [pulse, setPulse] = useState(0);
  const prevStars = useRef<number | null>(null);
  const pulseArmed = useRef(false);
  useEffect(() => {
    const prev = prevStars.current;
    prevStars.current = stars;
    if (prev === null || stars <= prev) return;
    if (!pulseArmed.current) {
      pulseArmed.current = true;
      return;
    }
    setPulse((p) => p + 1);
  }, [stars]);

  const dust = useMemo(() => {
    const rand = mulberry32(seedFrom(inputs.repo));
    return Array.from({ length: 90 }, () => ({
      x: rand() * W,
      y: rand() * H,
      r: rand() < 0.85 ? 0.7 : 1.3,
      o: 0.12 + rand() * 0.45,
    }));
  }, [inputs.repo, W, CLIP_BOTTOM]);

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
        t: 0.7 + rand() * 0.6,
      }));
    };
    // At relative rest the field barely drifts (5x slower than it used to):
    // cruise is a crawl, so the FTL jump while panning lands much harder.
    // `trail` is each depth's motion-streak ceiling: the background answers
    // OUR absolute speed (neighbors answer relative speed), with parallax
    // making near specks streak more than far ones.
    return [
      { id: 1, f: 0.15, dur: 750, warp: false, trail: 1.4, stars: mk("::far", 40, 0.4, 0.8, 0.08, 0.2) },
      { id: 2, f: 0.45, dur: 400, warp: false, trail: 3, stars: mk("::mid", 55, 0.5, 1.0, 0.12, 0.3) },
      { id: 3, f: 0.9, dur: 0, warp: true, trail: 5, stars: mk("::near", 45, 0.7, 1.5, 0.18, 0.45) },
    ];
  }, [inputs.repo, W, CLIP_BOTTOM]);

  // How fast WE move through the fixed field, 0..1. sqrt compresses the
  // long tail: ~900 stars/day pins the ceiling, single digits read as a
  // near-standstill. The streak trails behind apparent motion: we fly
  // toward the core, the field flows left, so trails extend right.
  const bgSpeedT = Math.min(1, Math.sqrt(Math.max(vOwn, 0)) / 30);

  // Parallel sequences beyond the core: when the window peeks past the
  // worldwide #1, other faint galaxies surface in the deep background. They
  // sit at infinite distance, so they are pinned to the viewport (zero
  // parallax) and deliberately unnamed: the journey does not end at the core.
  const galaxies = useMemo(() => {
    const rand = mulberry32(seedFrom(inputs.repo + "::beyond"));
    const tints = ["cool", "pale", "warm", "cool"] as const;
    return Array.from({ length: 4 }, (_, i) => ({
      fx: 0.5 + i * 0.13 + rand() * 0.05,
      y: 66 + rand() * 92,
      rx: 24 + rand() * 26,
      ry: 6 + rand() * 8,
      rot: -30 + rand() * 60,
      tint: tints[i],
      seq: ["02", "03", "05", "08"][i],
      dots: Array.from({ length: 8 }, () => ({
        dx: (rand() - 0.5) * 76,
        dy: (rand() - 0.5) * 30,
        r: 0.5 + rand() * 0.7,
        o: 0.25 + rand() * 0.4,
      })),
    }));
  }, [inputs.repo, W, CLIP_BOTTOM]);

  // FTL stretch while panning: armed by wheel events, relaxes shortly after.
  // The zone sets the regime: "local" pans fine, "route" pans fast with a
  // more exaggerated stretch and a hotter sound bed.
  const [warpZone, setWarpZone] = useState<"local" | "route" | null>(null);
  const [warpDir, setWarpDir] = useState<1 | -1>(1); // 1 = toward the core (blueshift)

  // Discovery hint: a drifting accent chevron tells first-time pilots the
  // chart pans; the first real pan dismisses it for good (localStorage).
  const [panHint, setPanHint] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("mc_pan_hint") !== "done") setPanHint(true);
    } catch { /* private mode */ }
  }, []);
  const warpTimer = useRef<number | null>(null);
  const armWarp = (zone: "local" | "route") => {
    setWarpZone(zone);
    if (warpTimer.current !== null) clearTimeout(warpTimer.current);
    warpTimer.current = window.setTimeout(() => setWarpZone(null), 200);
  };

  // Fly the window back to the default view: an eased ~0.9s journey in log
  // space with the warp armed the whole way, so coming home FEELS like
  // travel (streaking stars, doppler tint) instead of a teleport.
  const flyingHome = useRef(false);
  const flyHome = () => {
    const from = view;
    if (!from || flyingHome.current) return;
    flyingHome.current = true;
    const g = geom.current;
    const to = { lo: g.defLo, hi: g.defHi };
    setWarpDir(to.lo < from.lo ? -1 : 1); // heading back = redshift tint
    sound.warpPan(0);
    const t0 = performance.now();
    const DUR = 900;
    // the window is already in log10(stars) space, so a linear lerp here
    // IS perceptually uniform travel
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / DUR);
      const e = 1 - Math.pow(1 - k, 3);
      if (k < 1) {
        armWarp("local");
        setView({
          lo: from.lo + (to.lo - from.lo) * e,
          hi: from.hi + (to.hi - from.hi) * e,
        });
        requestAnimationFrame(step);
      } else {
        setView(null);
        flyingHome.current = false;
      }
    };
    requestAnimationFrame(step);
  };

  // ---------- geometry ----------
  const ahead = etas.filter((n) => n.gap > 0).sort((a, b) => a.gap - b.gap).slice(0, 10);
  const behind = etas.filter((n) => n.gap <= 0).sort((a, b) => b.gap - a.gap).slice(0, 3);
  const gateX = nextMilestone?.threshold ?? null;

  // Density-adaptive default window: the opening bracket frames the local
  // traffic comfortably (about 8 ships ahead plus the trailing escorts)
  // instead of stretching to a fixed span. Dense neighborhoods open tight,
  // sparse ones open wide; the next gate only joins the frame when it is
  // genuinely nearby. Everything else is one pan away.
  const aheadSpread = ahead.length
    ? Math.max(ahead[Math.min(7, ahead.length - 1)].s - stars, stars * 0.004)
    : Math.max((gateX ?? stars * 1.6) - stars, stars * 0.05);
  let aMaxDefault = stars + aheadSpread * 1.3;
  if (gateX !== null && gateX <= stars + aheadSpread * 2.6) {
    aMaxDefault = Math.max(aMaxDefault, gateX + aheadSpread * 0.18);
  }
  const behindSpread = behind.length
    ? Math.max(stars - Math.min(...behind.map((n) => n.s)), stars * 0.002)
    : stars * 0.012;
  const aMinDefault = Math.max(1, stars - behindSpread * 1.25);

  const coreStars = apex?.s ?? Math.max(stars * 8, 400_000);
  const bMin = log10(Math.min(stars * 0.96, aMinDefault));
  const bMax = log10(coreStars * 1.06);

  const defLo = Math.max(bMin, log10(aMinDefault));
  const defHi = Math.min(bMax, log10(aMaxDefault));

  // AUTO-ZOOM frame: don't reuse the count-based default; FRAME the salient set
  // (hero + the nearest neighbours) directly, choosing the LARGEST K whose
  // framing keeps adjacent labels >= TARGET_PX apart. Dense clusters drop to a
  // few ships and zoom IN so they read; sparse systems keep the nearest rival in
  // view so the screen is never empty. The frame = the set's star range + a
  // margin. Off -> the wide default. Suspended while panning (view wins).
  let azLo = defLo;
  let azHi = defHi;
  if (autoZoom) {
    // the salient set = hero + the nearest few neighbours that carry labels
    const nbrs = [...ahead, ...behind]
      .sort((a, b) => Math.abs(a.s - stars) - Math.abs(b.s - stars))
      .slice(0, 4);
    if (nbrs.length) {
      const set = Array.from(new Set([stars, ...nbrs.map((n) => n.s)])).sort((a, b) => a - b);
      const plotPx = W - 80;
      const TARGET_PX = 165 * fs; // label room between the two TIGHTEST ships
      let minGap = Infinity;
      for (let i = 1; i < set.length; i++) minGap = Math.min(minGap, log10(set[i]) - log10(set[i - 1]));
      // span that puts the tightest adjacent pair exactly TARGET_PX apart (zoom
      // IN on dense clusters), but at least wide enough to FIT the whole set
      // (zoom OUT on sparse so the nearest rival stays in view).
      const spanLegible = minGap > 0 && minGap < Infinity ? (minGap * plotPx) / TARGET_PX : 0;
      const spanRange = (log10(set[set.length - 1]) - log10(set[0])) * 1.18;
      const defSpan = defHi - defLo;
      let span = Math.max(spanLegible, spanRange);
      span = Math.max(0.004, Math.min(span, defSpan * 3)); // tiny floor, generous cap
      // Anchor the hero at ~33% from the left so its ring, wake and any trailing
      // neighbours always have room and NEVER clip the left edge; the chase ahead
      // fills the right. (Centring on the set midpoint shoved the hero to the
      // edge whenever every salient neighbour was ahead of it.)
      const HERO_FRAC = 0.33;
      const hl = log10(stars);
      azLo = hl - HERO_FRAC * span;
      azHi = azLo + span;
      if (azLo < bMin) { azLo = bMin; azHi = bMin + span; } // shifts hero right, never clips
      if (azHi > bMax) azHi = bMax;
    }
  }

  const logLo = view?.lo ?? azLo;
  const logHi = view?.hi ?? azHi;
  const span = logHi - logLo;

  const ax = (s: number) => 40 + ((log10(s) - logLo) / span) * (W - 80);

  // LIVE DRIFT (player frame): our ship IS the camera, so it never moves;
  // every other local creeps at its velocity RELATIVE to ours between data
  // anchors. In tightly packed fast scenes (apple/container gains a star
  // every ~20s against 4-star gaps) overtakes become visible IN REAL TIME.
  // Positions are recomputed each tick from anchor + elapsed (NOT a CSS
  // transform: a second coordinate system would visibly rebound on every
  // re-anchor). The clock only starts when the fastest relative mover
  // covers pixels a human could actually notice during a visit; every
  // other scene pays nothing. Labels/etas keep the anchor's real numbers:
  // the drift moves ships, never data.
  const pxPerStar = (ax(stars * 1.001) - ax(stars)) / Math.max(stars * 0.001, 1);
  const maxRelV = Math.max(0, ...inputs.neighbors.map((n) => Math.abs((n.v || 0) - vOwn)));
  const driftHot = pxPerStar * maxRelV >= 1000; // ~0.7px per minute floor
  const [driftNowMs, setDriftNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (!driftHot) {
      setDriftNowMs(null);
      return;
    }
    setDriftNowMs(Date.now());
    const id = window.setInterval(() => setDriftNowMs(Date.now()), 4_000);
    return () => window.clearInterval(id);
  }, [driftHot, nowMs]);
  // cap extrapolation at 45 min: a zombie tab must not invent the future
  const driftDays =
    driftNowMs === null ? 0 : Math.min(Math.max(0, driftNowMs - nowMs), 45 * 60_000) / 86_400_000;
  const driftS = (s: number, v: number | null | undefined) =>
    !driftDays || v == null ? s : Math.max(1, s + (v - vOwn) * driftDays);

  // DECK scatter: context dots fan out into a 2D star system (seeded per
  // repo, stable across renders and pans). The rail stays the racing line:
  // neighbors and anything labeled keep flying on it; x remains the data.
  const scatter = (r: string) => {
    if (!deck) return 0;
    const u = mulberry32(seedFrom(r))() * 2 - 1;
    return Math.sign(u || 1) * (16 + Math.abs(u) * 74); // 16..90px off the rail
  };

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

  // the ambient pad rises gently as the window travels toward the core,
  // where the sky is busier: position as a frequency, like everything else
  const travelT = (logLo - bMin) / Math.max(bMax - bMin, 1e-6);
  useEffect(() => {
    sound.setTravelPosition(travelT);
  }, [travelT]);
  const layerOffset = (f: number) => -((((worldX * f) % W) + W) % W);

  // "home"/reset return to the AUTO-ZOOM frame, so double-click and flyHome
  // settle on the legible neighbourhood, not the wide count-based default.
  const geom = useRef({ defLo: azLo, defHi: azHi, bMin, bMax });
  geom.current = { defLo: azLo, defHi: azHi, bMin, bMax };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!e.ctrlKey && !horizontal && !e.shiftKey) return;
      e.preventDefault();
      // first real pan dismisses the discovery hint forever
      setPanHint(false);
      try {
        localStorage.setItem("mc_pan_hint", "done");
      } catch { /* private mode */ }
      // panning regime by pointer zone: fine over the local system, fast
      // over the route band (it is a faster ship down there)
      const rect = el.getBoundingClientRect();
      const yView = ((e.clientY - rect.top) / Math.max(rect.height, 1)) * H;
      const zone: "local" | "route" = yView > CLIP_BOTTOM + 12 ? "route" : "local";
      if (e.ctrlKey) sound.zoomTick(e.deltaY < 0);
      else {
        sound.warpPan(zone === "route" ? 1 : 0);
        armWarp(zone);
        setWarpDir((horizontal ? e.deltaX : e.deltaY) > 0 ? 1 : -1);
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
        const speed = zone === "route" ? 8 : 1.6;
        const shift = (d / 600) * sp * speed;
        const nLo = Math.min(Math.max(lo + shift, g.bMin), g.bMax - sp);
        return { lo: nLo, hi: nLo + sp };
      });
    };
    // TOUCH: one finger drags the map (the window follows the finger), two
    // fingers pinch-zoom. touch-action: pan-y (set on the svg) leaves
    // vertical page scroll to the browser and gives us the horizontal axis.
    const pointers = new Map<number, { x: number; y: number }>();
    let lastDist = 0;
    const dismissHint = () => {
      setPanHint(false);
      try {
        localStorage.setItem("mc_pan_hint", "done");
      } catch { /* private mode */ }
    };
    const panBy = (d: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const yView = ((clientY - rect.top) / Math.max(rect.height, 1)) * H;
      const zone: "local" | "route" = yView > CLIP_BOTTOM + 12 ? "route" : "local";
      sound.warpPan(zone === "route" ? 1 : 0);
      armWarp(zone);
      setWarpDir(d > 0 ? 1 : -1);
      const g = geom.current;
      setView((v) => {
        const lo = v?.lo ?? g.defLo;
        const hi = v?.hi ?? g.defHi;
        const sp = hi - lo;
        const speed = zone === "route" ? 8 : 1.6;
        const shift = (d / 600) * sp * speed;
        const nLo = Math.min(Math.max(lo + shift, g.bMin), g.bMax - sp);
        return { lo: nLo, hi: nLo + sp };
      });
    };
    const zoomBy = (deltaY: number) => {
      sound.zoomTick(deltaY < 0);
      const g = geom.current;
      setView((v) => {
        const lo = v?.lo ?? g.defLo;
        const hi = v?.hi ?? g.defHi;
        const sp = hi - lo;
        const c = (lo + hi) / 2;
        let ns = sp * (1 + deltaY / 250);
        ns = Math.min(Math.max(ns, 0.004), g.bMax - g.bMin);
        let nLo = c - ns / 2;
        nLo = Math.min(Math.max(nLo, g.bMin), g.bMax - ns);
        return { lo: nLo, hi: nLo + ns };
      });
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        lastDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        const dx = prev.x - e.clientX; // dragging the map, not the window
        if (Math.abs(dx) < 0.5) return;
        dismissHint();
        panBy(dx * 2.2, e.clientY);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastDist > 0 && Math.abs(dist - lastDist) > 1) {
          dismissHint();
          zoomBy((lastDist - dist) * 2.4);
        }
        lastDist = dist;
      }
    };
    const onPointerEnd = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      lastDist = 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerEnd);
    el.addEventListener("pointercancel", onPointerEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerEnd);
      el.removeEventListener("pointercancel", onPointerEnd);
    };
  }, []);

  // ---------- band A content ----------
  const neighborNames = useMemo(() => new Set(etas.map((n) => n.r)), [etas]);
  const visNbrs = [...behind, ...ahead].filter((n) => inWindow(n.s));
  const visDots = inputs.routeAll.filter(
    (p) => inWindow(p.s) && !neighborNames.has(p.r) && p.r !== apex?.r && p.r !== inputs.repo
  );

  const LABEL_MAX = 13;
  const dotBudget = Math.max(0, LABEL_MAX - visNbrs.length);
  // label candidates by STORY value (fastest movers first), not an every-Nth
  // sample: routed dots are full synthetic neighbors now, and an unlabeled
  // orange hunter next to empty space read as a bug. The width-aware tier
  // pass below still sheds whatever genuinely does not fit.
  const labeledDotSet = new Set(
    [...visDots]
      .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))
      .slice(0, dotBudget)
      .map((p) => p.r)
  );

  const items: AItem[] = [
    ...visNbrs.map((n): AItem => ({ kind: "n", s: n.s, n })),
    ...visDots
      .filter((p) => labeledDotSet.has(p.r))
      .map((p): AItem => {
        // a routed dot with a registry velocity is PROMOTED to a full
        // synthetic neighbor: same label grammar (gap, v, eta/catches),
        // same tails and the same scan card as the live band. Its velocity
        // is the daily registry diff instead of a live measurement, which
        // is indistinguishable at route distances.
        if (p.v != null) {
          const n = neighborEtas(
            [{ r: p.r, s: p.s, v: p.v, d: p.d ?? null, l: p.l ?? null }],
            stars,
            vOwn
          )[0];
          return { kind: "n", s: p.s, n };
        }
        return { kind: "d", s: p.s, p };
      }),
  ].sort((a, b) => a.s - b.s);

  // NYT rule B — proximity hover: a 1D-Voronoi hit layer behind every mark so
  // hovering ANYWHERE in the local band snaps to the nearest system's scan
  // card (no dead zones between the small dots). Hover-only, reuses openScan;
  // pan/zoom are native listeners on the svg, so these never block the drag.
  const proxMarks = items
    .map((it) => ({ it, x: ax(driftS(it.s, it.kind === "n" ? it.n.v : it.p.v)) }))
    .sort((a, b) => a.x - b.x);
  const proxZones = proxMarks.map((m, i) => {
    const left = i === 0 ? 28 : (proxMarks[i - 1].x + m.x) / 2;
    const right = i === proxMarks.length - 1 ? W - 28 : (proxMarks[i + 1].x + m.x) / 2;
    return { it: m.it, x: m.x, left, w: Math.max(0, right - left) };
  });

  // T8 — the ONE most-active uncharted system in view emits a radio signal.
  const signalRepo = chartedSet
    ? (items
        .flatMap((it) =>
          it.kind === "n" && !chartedSet.has(it.n.r.toLowerCase()) && it.n.v > 0 ? [it.n] : [],
        )
        .sort((a, b) => b.v - a.v)[0]?.r ?? null)
    : null;

  // Tier assignment is aware of each label's real width, so long names like
  // "coding-interview-university" never overlap their neighbors. Neighbors
  // claim tiers first; whoever finds no free tier SHEDS its label and stays
  // as a bare dot (tier -1), with all its data still on hover.
  const tiers: number[] = new Array(items.length).fill(-1);
  {
    // the deck's taller canvas buys two extra tiers per side
    const nTiers = deck ? 5 : 3;
    const rowsAbove: number[] = new Array(nTiers).fill(-1e9); // rightmost occupied edge per tier
    const rowsBelow: number[] = new Array(nTiers).fill(-1e9);
    // label priority: hunters first (the chart's most urgent object must
    // never be shed in dense zones), then chase targets with an eta, then
    // the rest of the neighbors, route dots last
    const prio = (it: AItem) => {
      if (it.kind !== "n") return 3;
      if (it.n.gap <= 0 && it.n.catchDays !== null) return 0;
      if (it.n.gap > 0 && it.n.etaDays !== null) return 1;
      return 2;
    };
    const order = items
      .map((_, i) => i)
      .sort((a, b) => prio(items[a]) - prio(items[b]) || ax(items[a].s) - ax(items[b].s));
    for (const i of order) {
      const it = items[i];
      const x = ax(it.s);
      const name = trunc(shortName(it.kind === "n" ? it.n.r : it.p.r));
      const halfW = (Math.max(name.length, 12) * 7.6 * fs) / 2 + 10;
      // hunters (behind us but closing) label ABOVE the line with the
      // chase: their catch eta is the most urgent number on the chart
      const hunts = it.kind === "n" && it.n.gap <= 0 && it.n.catchDays !== null;
      const rows = it.kind === "n" && it.n.gap <= 0 && !hunts ? rowsBelow : rowsAbove;
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

  const visGates = inputs.milestones.filter((m) => inWindow(m.at ?? m.threshold));
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

  // Beyond-the-core reveal: as the core glow slides left inside the window,
  // the uncharted side opens up on the right and the parallel sequences fade
  // in. Each galaxy only shows once it has clear space right of the core.
  const coreX = apex ? ax(coreStars) : null;
  const beyondT =
    coreX !== null ? Math.min(1, Math.max(0, ((W - 60 - coreX) / (W - 100)) * 1.4)) : 0;
  const lineEndX = coreX !== null && coreX < W - 40 ? Math.max(coreX, 40) : W - 40;

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

  // A small classification sigil to the LEFT of a centred node label, vertically
  // centred on it. Returns null for unclassified repos (the honest neutral
  // state), so only badged systems wear a mark.
  const nodeSigil = (repo: string, cx: number, textY: number, name: string) => {
    const k = badgeMap?.[repo.toLowerCase()];
    if (!k) return null;
    // identical to the hero ship's sigil: same size (17*fs) and same gap to
    // the name (sz + 3), so every node's badge reads at the protagonist's scale
    const sz = Math.round(17 * fs);
    const half = (name.length * 7.6 * fs) / 2;
    return (
      <g transform={`translate(${(cx - half - sz - 3).toFixed(1)}, ${(textY - sz / 2 - 4).toFixed(1)})`}>
        <BadgeSigil badgeKey={k} size={sz} />
      </g>
    );
  };

  return (
    // no scroll container here: every mount is lg+ and the svg scales to
    // fit, while an overflow-x-auto wrapper turned overflow-y auto too, so
    // a scan card opening past the bottom edge spawned a phantom vertical
    // scrollbar and clipped the card
    <div className="w-full">
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          style={{ touchAction: "pan-y" }}
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
            {/* the dashboard renders TWO charts at once (panel + deck
                overlay); duplicate SVG ids resolve to the FIRST one in the
                document, so the deck was clipping with the panel's shorter
                rect and the below-line labels vanished. Suffix per mode. */}
            <clipPath id={deck ? "bandAClip-deck" : "bandAClip"}>
              <rect x={28} y={0} width={W - 56} height={CLIP_BOTTOM} />
            </clipPath>
            <radialGradient id="gal-cool">
              <stop offset="0%" stopColor={C.white} stopOpacity="0.9" />
              <stop offset="35%" stopColor={C.accent} stopOpacity="0.35" />
              <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
            </radialGradient>
            <radialGradient id="gal-warm">
              <stop offset="0%" stopColor={C.white} stopOpacity="0.85" />
              <stop offset="40%" stopColor={C.warn} stopOpacity="0.22" />
              <stop offset="100%" stopColor={C.warn} stopOpacity="0" />
            </radialGradient>
            <radialGradient id="gal-pale">
              <stop offset="0%" stopColor={C.white} stopOpacity="0.9" />
              <stop offset="45%" stopColor={C.dim} stopOpacity="0.25" />
              <stop offset="100%" stopColor={C.dim} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="fadeBeyond" gradientUnits="userSpaceOnUse"
              x1={lineEndX} y1="0" x2={W - 40} y2="0">
              <stop offset="0%" stopColor={C.grid} stopOpacity="1" />
              <stop offset="55%" stopColor={C.grid} stopOpacity="0.25" />
              <stop offset="100%" stopColor={C.grid} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* dust parallax: drift speed follows our own velocity */}
          <g
            className="dust-layer"
            style={{ animationDuration: `${Math.max(125, 550 - vOwn / 1.6)}s` }}
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
          <text x={40} y={30} fill={C.dim} fontSize={12 * fs} letterSpacing={4} className="font-display">
            LOCAL SYSTEM
          </text>
          <text x={40} y={47} fill={C.faint} fontSize={10.5 * fs}>
            scroll sideways to pan · pinch to zoom · doppler tails: length = speed gap · blue = you gain the duel, red = it outruns you
          </text>
          {/* AUTO-ZOOM toggle: frames the local system for legibility on load */}
          <text
            x={W - 40}
            y={30}
            textAnchor="end"
            fontSize={11 * fs}
            fill={autoZoom ? C.accent : C.faint}
            opacity={0.85}
            style={{ cursor: "pointer" }}
            onClick={toggleAutoZoom}
          >
            {autoZoom ? "◉" : "○"} AUTO-ZOOM
          </text>
          {!isDefaultView ? (
            <text x={W - 40} y={48} fill={C.accent} fontSize={11 * fs} textAnchor="end" opacity={0.8}>
              window {fmtCompact(Math.round(Math.pow(10, logLo)))} .. {fmtCompact(Math.round(Math.pow(10, logHi)))} ★
            </text>
          ) : null}

          {/* the route line loses meaning past the #1: it fades into the dark */}
          <line x1={40} y1={BAND_A_Y} x2={lineEndX} y2={BAND_A_Y} stroke={C.grid} strokeWidth={1} />
          {lineEndX < W - 40 ? (
            <line x1={lineEndX} y1={BAND_A_Y} x2={W - 40} y2={BAND_A_Y}
              stroke="url(#fadeBeyond)" strokeWidth={1} />
          ) : null}

          <g clipPath={deck ? "url(#bandAClip-deck)" : "url(#bandAClip)"}>
            {/* proximity hit layer (NYT rule B): at the back so every real
                mark stays on top and keeps its own hover; these only fire in
                the gaps, snapping to the nearest system. */}
            {proxZones.map(({ it, x, left, w }) => (
              <rect
                key={`pz-${it.kind === "n" ? it.n.r : it.p.r}`}
                x={left}
                y={BAND_A_Y - 30}
                width={w}
                height={60}
                fill="transparent"
                onMouseEnter={() =>
                  openScan(
                    it.kind === "n"
                      ? { kind: "neighbor", n: it.n, xPct: clampPct((x / W) * 100), topPct: bandATop, place: "below" }
                      : { kind: "route", p: it.p, xPct: clampPct((x / W) * 100), topPct: bandATop, place: "below" },
                  )
                }
                onMouseLeave={scheduleClose}
              />
            ))}
            {/* multi-depth parallax: each layer shifts with the pan at its
                depth factor (travel) and drifts on its own clock (time).
                The near layer stretches into FTL streaks while panning. */}
            {starLayers.map((layer) => (
              <g
                key={layer.id}
                className={
                  layer.warp && warpZone
                    ? warpDir === 1
                      ? "warp-tint-fwd"
                      : "warp-tint-back"
                    : undefined
                }
                style={{
                  transform: `translateX(${layerOffset(layer.f).toFixed(1)}px)`,
                  transition: "transform 90ms linear",
                }}
              >
                <g
                  className="dust-stream"
                  style={{
                    animationDuration: `${(layer.dur || Math.max(50, 1400 / Math.sqrt(Math.max(vOwn, 4)))).toFixed(1)}s`,
                    // the wrap distance must match the variable deck width
                    "--dust-w": `-${W}px`,
                  } as React.CSSProperties}
                >
                  {[0, W, 2 * W].map((dx) => (
                    <g key={dx} transform={`translate(${dx} 0)`}>
                      {layer.stars.map((p, i) => {
                        const trail = layer.trail * bgSpeedT * p.t;
                        return (
                          <g key={i}>
                            {trail >= 0.7 ? (
                              <line
                                x1={p.x} y1={p.y} x2={p.x + trail} y2={p.y}
                                stroke={C.speck}
                                strokeWidth={Math.min(p.r * 0.9, 0.8)}
                                strokeLinecap="round"
                                opacity={p.o * 0.4}
                              />
                            ) : null}
                            <circle
                              className={
                                layer.warp
                                  ? warpZone === "route"
                                    ? "star-warp warping-fast"
                                    : warpZone === "local"
                                      ? "star-warp warping"
                                      : "star-warp"
                                  : undefined
                              }
                              cx={p.x}
                              cy={p.y}
                              r={p.r}
                              fill={C.speck}
                              opacity={p.o}
                            />
                          </g>
                        );
                      })}
                    </g>
                  ))}
                </g>
              </g>
            ))}
            {beyondT > 0.04 ? (
              <g>
                {galaxies.map((g) => {
                  const gx = g.fx * W;
                  const local =
                    beyondT * Math.min(1, Math.max(0, (gx - (coreX ?? 0) - 90) / 150));
                  if (local <= 0.03) return null;
                  return (
                    <g key={g.seq} opacity={local}>
                      <ellipse cx={gx} cy={g.y} rx={g.rx} ry={g.ry}
                        transform={`rotate(${g.rot} ${gx} ${g.y})`}
                        fill={`url(#gal-${g.tint})`} opacity={0.5} />
                      <ellipse cx={gx} cy={g.y} rx={g.rx * 0.32} ry={g.ry * 0.5}
                        transform={`rotate(${g.rot} ${gx} ${g.y})`}
                        fill={`url(#gal-${g.tint})`} opacity={0.8} />
                      {g.dots.map((d, j) => (
                        <circle key={j} cx={gx + d.dx} cy={g.y + d.dy} r={d.r}
                          fill={C.speck} opacity={d.o * 0.5} />
                      ))}
                      {local > 0.45 ? (
                        <text x={Math.min(gx, W - 170)} y={g.y + g.ry + 18} fill={C.faint}
                          fontSize={10 * fs} letterSpacing={2} textAnchor="middle">
                          PARALLEL SEQUENCE {g.seq} · UNCHARTED
                        </text>
                      ) : null}
                    </g>
                  );
                })}
                <text x={W - 44} y={70} fill={C.accent} fontSize={11.5 * fs} letterSpacing={3}
                  textAnchor="end" opacity={Math.min(0.9, beyondT)} className="font-display">
                  EDGE OF CHARTED SPACE
                </text>
                <text x={W - 44} y={84} fill={C.dim} fontSize={10.5 * fs} textAnchor="end"
                  opacity={Math.min(0.85, beyondT)}>
                  parallel sequences detected · the journey does not end at the core
                </text>
              </g>
            ) : null}
            {visGates.map((m) => {
              // gate ETA, same model as the StatusBar headline: gap to the
              // threshold over our v7d minus the threshold's drift. Anchored on
              // the gate so the milestone time reads as a point on the route.
              const gGap = Math.max(0, m.threshold - stars);
              const net = vOwn - (m.drift ?? 0);
              const gEta = gGap === 0 ? "crossed" : net > 0 ? ` · in ${fmtEtaDays(gGap / net)}` : "";
              return (
                <g key={m.rank}>
                  <line
                    x1={ax(m.at ?? m.threshold)} y1={26} x2={ax(m.at ?? m.threshold)} y2={BAND_A_Y + 38}
                    stroke={C.accent} strokeWidth={1} strokeDasharray="2 4" opacity={0.7}
                  />
                  <text
                    x={Math.min(Math.max(ax(m.at ?? m.threshold), 150), W - 190)} y={18} fill={C.accent} fontSize={12 * fs}
                    textAnchor="middle" letterSpacing={2}
                  >
                    TOP {m.rank} GATE · {fmt(m.threshold)}{gEta}
                  </text>
                </g>
              );
            })}

            {panHint && inWindow(stars) ? (
              <g className="pan-hint">
                <text x={W - 76} y={CLIP_BOTTOM - 16} textAnchor="end" fontSize={11.5 * fs}
                  fill={C.accent} letterSpacing={2} className="numeral" opacity={0.9}>
                  PAN
                </text>
                <g className="pan-hint-arrows">
                  <text x={W - 68} y={CLIP_BOTTOM - 15.5} fontSize={14} fill={C.accent}>
                    ›››
                  </text>
                </g>
              </g>
            ) : null}

            {/* far from home: a white compass in the same lower-right slot
                the PAN hint uses (they never coexist). The chevrons point
                wherever home went; clicking flies the window back with the
                full warp smear instead of teleporting. */}
            {view !== null && !inWindow(stars) ? (
              <g onClick={flyHome} style={{ cursor: "pointer" }}>
                <rect x={W - 180} y={CLIP_BOTTOM - 34} width={160} height={28} fill="transparent" />
                <text x={W - 40} y={CLIP_BOTTOM - 16} textAnchor="end" fontSize={12 * fs} fill={C.white}
                  letterSpacing={2} className="numeral" opacity={0.95}>
                  {/* the window lives in log10(stars) space */}
                  {log10(stars) < view.lo ? "‹‹‹ CENTER" : "CENTER ›››"}
                </text>
              </g>
            ) : null}

            {visDots
              .filter((p) => !labeledDotSet.has(p.r))
              .map((p) => {
                const color = routeDotColor.get(p.r) ?? C.white;
                const tail = dotTail(p.v);
                const xp = ax(driftS(p.s, p.v));
                const yp = BAND_A_Y + scatter(p.r);
                return (
                  <g
                    key={p.r}
                    className="nbr"
                    onMouseEnter={() =>
                      openScan({ kind: "route", p, xPct: clampPct((xp / W) * 100), topPct: ((yp + 18) / H) * 100, place: "below" })
                    }
                    onMouseLeave={scheduleClose}
                    onClick={() => togglePin(p.r)}
                  >
                    <circle cx={xp} cy={yp} r={8} fill="transparent" />
                    {tail ? (
                      <path d={tailPath(xp, yp, tail.len, tail.dir, 1.2)}
                        fill={color} opacity={0.22} />
                    ) : null}
                    <circle className="nbr-dot" cx={xp} cy={yp} r={1.6}
                      fill={color} opacity={0.6} />
                  </g>
                );
              })}

            {items.map((it, i) => {
              const x = ax(driftS(it.s, it.kind === "n" ? it.n.v : it.p.v));
              const isTarget = target !== null && (it.kind === "n" ? it.n.r : it.p.r) === target;
              if (it.kind === "n") {
                const n = it.n;
                const isAhead = n.gap > 0;
                const dop = dopplerFor(n.v / Math.max(vOwn, 1), isAhead, C);
                const color = dop.color;
                if (tiers[i] === -1) {
                  // label shed: bare interactive dot, data stays on hover
                  return (
                    <g
                      key={n.r}
                      className="nbr"
                      style={{ animation: `ship-in 0.5s ease-out ${Math.min(i, 16) * 45}ms both` }}
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
                      {dop.tailLen > 0 ? (
                        <path d={tailPath(x, BAND_A_Y, dop.tailLen, dop.tailDir, dop.girth)}
                          fill={color} opacity={dop.threat ? 0.45 : isAhead ? 0.3 : 0.18} />
                      ) : null}
                      {n.r === signalRepo ? (
                        <circle className="sig-ping" cx={x} cy={BAND_A_Y} r={4} fill="none" stroke={color} strokeWidth={1.1} />
                      ) : null}
                      {chartedSet && !chartedSet.has(n.r.toLowerCase()) ? (
                        <circle className="nbr-dot" cx={x} cy={BAND_A_Y} r={3.6} fill="none" stroke={color} strokeWidth={1.3} opacity={isAhead ? 0.85 : 0.5} />
                      ) : (
                        <circle className="nbr-dot" cx={x} cy={BAND_A_Y} r={3.2} fill={color} opacity={isAhead ? 0.95 : 0.55} />
                      )}
                    </g>
                  );
                }
                const hunts = !isAhead && n.catchDays !== null;
                const labelAbove = isAhead || hunts;
                const tierY = labelAbove
                  ? BAND_A_Y - 44 - tiers[i] * 40
                  : BAND_A_Y + 64 + tiers[i] * 34;
                const lineY1 = labelAbove ? tierY + 8 : BAND_A_Y + 6;
                const lineY2 = labelAbove ? BAND_A_Y - 5 : tierY - 24;
                return (
                  <g
                    key={n.r}
                    className="nbr"
                    style={{ animation: `ship-in 0.5s ease-out ${Math.min(i, 16) * 45}ms both` }}
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
                    {dop.tailLen > 0 ? (
                      <>
                        <path d={tailPath(x, BAND_A_Y, dop.tailLen, dop.tailDir, dop.girth)}
                          fill={color} opacity={dop.threat ? 0.5 : isAhead ? 0.32 : 0.2} />
                        {[0, 1].map((k) => (
                          <circle
                            key={k}
                            className="vel-streak"
                            cx={x}
                            cy={BAND_A_Y}
                            r={1.2}
                            fill={color}
                            style={{
                              "--drift": `${dop.tailDir * (dop.tailLen + 5)}px`,
                              "--dur": `${dop.dur.toFixed(2)}s`,
                              animationDelay: k === 1 ? `${(dop.dur / 2).toFixed(2)}s` : undefined,
                            } as React.CSSProperties}
                          />
                        ))}
                      </>
                    ) : null}
                    <circle className="nbr-dot" cx={x} cy={BAND_A_Y} r={3.2} fill={color} opacity={isAhead ? 0.95 : 0.55} />
                    {nodeSigil(n.r, x, tierY - 13, trunc(shortName(n.r)))}
                    <text className="nbr-name" x={x} y={tierY - 13} fill={labelAbove ? C.ink : C.faint} fontSize={12.5 * fs}
                      textAnchor="middle">
                      {trunc(shortName(n.r))}
                    </text>
                    {/* passed ships compress to two lines so the below band
                        never outgrows its tier spacing or the clip */}
                    <text x={x} y={tierY + 1} fill={C.dim} fontSize={11 * fs} textAnchor="middle">
                      {fmtSignedGap(n.gap)} · {Math.round(n.v)}/d
                      {!labelAbove ? " · passed" : ""}
                    </text>
                    {labelAbove ? (
                      <text x={x} y={tierY + 14} fontSize={11 * fs} textAnchor="middle"
                        fill={hunts ? color : n.receding ? C.warn : C.accent}>
                        {hunts
                          ? `catches you in ${fmtEtaRange(n.catchDays, n.etaRange)}`
                          : n.receding
                            ? "pulling away"
                            : `eta ${fmtEtaRange(n.etaDays, n.etaRange)}`}
                      </text>
                    ) : null}
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
              const tierY = BAND_A_Y - 44 - tiers[i] * 40;
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
                  {(() => {
                    const tail = dotTail(p.v);
                    return tail ? (
                      <path d={tailPath(x, BAND_A_Y, tail.len, tail.dir, 1.4)}
                        fill={routeDotColor.get(p.r) ?? C.white} opacity={0.25} />
                    ) : null;
                  })()}
                  <circle className="nbr-dot" cx={x} cy={BAND_A_Y} r={2.4}
                    fill={routeDotColor.get(p.r) ?? C.white} opacity={0.85} />
                  {nodeSigil(p.r, x, tierY - 2, trunc(shortName(p.r)))}
                  <text className="nbr-name" x={x} y={tierY - 2} fill={C.ink} fontSize={12.5 * fs} textAnchor="middle">
                    {trunc(shortName(p.r))}
                  </text>
                  <text x={x} y={tierY + 12} fill={C.dim} fontSize={11 * fs} textAnchor="middle">
                    {fmtCompact(p.s)} · #{p.rank}
                    {p.v != null ? ` · ${Math.round(p.v)}/d` : ""}
                  </text>
                </g>
              );
            })}

            {origin && inWindow(origin.s) ? (
              neighborNames.has(origin.r) ? (
                // the origin is an already-labeled neighbor: ring its own
                // node instead of duplicating a label next to someone else
                <path
                  d={`M ${ax(origin.s)} ${BAND_A_Y - 9} L ${ax(origin.s) + 7} ${BAND_A_Y} L ${ax(origin.s)} ${BAND_A_Y + 9} L ${ax(origin.s) - 7} ${BAND_A_Y} Z`}
                  fill="none" stroke={C.accent} strokeWidth={1.3}
                />
              ) : (
                <g>
                  <path
                    d={`M ${ax(origin.s)} ${BAND_A_Y - 7} L ${ax(origin.s) + 5} ${BAND_A_Y} L ${ax(origin.s)} ${BAND_A_Y + 7} L ${ax(origin.s) - 5} ${BAND_A_Y} Z`}
                    fill="none" stroke={C.accent} strokeWidth={1.3}
                  />
                  <text x={ax(origin.s) + 9} y={BAND_A_Y + 3.5} fill={C.accent} fontSize={11.5 * fs}
                    textAnchor="start" opacity={0.9}>
                    {trunc(shortName(origin.r))} · origin
                  </text>
                </g>
              )
            ) : null}

            {apex && inWindow(coreStars) ? (
              <g className="core-glow">
                <circle cx={ax(coreStars)} cy={BAND_A_Y} r={30} fill="url(#coreGrad)" />
                <circle cx={ax(coreStars)} cy={BAND_A_Y} r={4} fill={C.white} />
                {apex && badgeMap?.[apex.r.toLowerCase()] ? (
                  <g transform={`translate(${(ax(coreStars) + 9).toFixed(1)}, ${(BAND_A_Y - 9).toFixed(1)})`}>
                    <BadgeSigil badgeKey={badgeMap[apex.r.toLowerCase()]} size={Math.round(17 * fs)} />
                  </g>
                ) : null}
                <text x={ax(coreStars)} y={BAND_A_Y - 44} fill={C.white} fontSize={12 * fs}
                  textAnchor="middle" fontWeight={700}>
                  GALACTIC CORE · #1 {shortName(apex.r)}
                </text>
              </g>
            ) : null}

            {inWindow(stars) ? (
              <g>
                {/* our own trail: real velocity against the local traffic's
                    median pace, same length scale as every other tail. In
                    formation or slower = no trail; outrunning the band =
                    long white streak behind us. */}
                {shipTail > 0 ? (
                  <>
                    <path d={tailPath(ax(stars), BAND_A_Y, shipTail, -1, 2.2)} fill={C.white} opacity={0.5} />
                    {[0, 1].map((k) => (
                      <circle
                        key={k}
                        className="vel-streak"
                        cx={ax(stars)}
                        cy={BAND_A_Y}
                        r={1.3}
                        fill={C.white}
                        style={{
                          "--drift": `${-(shipTail + 6)}px`,
                          "--dur": `${shipDur.toFixed(2)}s`,
                          animationDelay: k === 1 ? `${(shipDur / 2).toFixed(2)}s` : undefined,
                        } as React.CSSProperties}
                      />
                    ))}
                  </>
                ) : null}
                <circle cx={ax(stars)} cy={BAND_A_Y} r={16} fill="url(#shipGrad)" opacity={0.5} />
                <circle className="ship-ping" cx={ax(stars)} cy={BAND_A_Y} r={13}
                  fill="none" stroke={C.accent} strokeWidth={1} />
                {pulse > 0 ? (
                  <circle key={pulse} className="star-pulse" cx={ax(stars)} cy={BAND_A_Y}
                    r={10} fill="none" stroke={C.warn} strokeWidth={1.5} />
                ) : null}
                <path
                  d={`M ${ax(stars)} ${BAND_A_Y - 7} L ${ax(stars) + 6} ${BAND_A_Y + 5} L ${ax(stars) - 6} ${BAND_A_Y + 5} Z`}
                  fill={C.white}
                  className="core-glow"
                />
                {/* the label clamps inside the band clip (the ship itself
                    never moves): hugging the left edge used to amputate the
                    first characters ("areer-ops") */}
                {(() => {
                  const half = (repoName.length * 7.6 * fs) / 2;
                  // the band clip starts at x=28; stay inside it
                  const lx = Math.min(Math.max(ax(stars), half + 32), W - half - 32);
                  const sz = Math.round(17 * fs);
                  return (
                    <>
                      {mainClass ? (
                        <g transform={`translate(${(lx - half - sz - 3).toFixed(1)}, ${(BAND_A_Y + 26 - sz / 2 - 4).toFixed(1)})`}>
                          <BadgeSigil badgeKey={mainClass} size={sz} />
                        </g>
                      ) : null}
                      <text x={lx} y={BAND_A_Y + 26} fill={C.white} fontSize={12.5 * fs}
                        textAnchor="middle" fontWeight={700}>
                        {repoName}
                      </text>
                      <text x={lx} y={BAND_A_Y + 41} fill={C.accent} fontSize={11.5 * fs}
                        textAnchor="middle">
                        {fmt(stars)} ★
                      </text>
                    </>
                  );
                })()}
              </g>
            ) : null}
          </g>

          {/* viewport connectors */}
          <line x1={40} y1={CLIP_BOTTOM} x2={vx0} y2={BAND_B_Y - 15}
            stroke={C.grid} strokeWidth={1} strokeDasharray="3 5" opacity={0.8} />
          <line x1={W - 40} y1={CLIP_BOTTOM} x2={vx1} y2={BAND_B_Y - 15}
            stroke={C.grid} strokeWidth={1} strokeDasharray="3 5" opacity={0.8} />

          {/* ============ BAND B: ROUTE TO THE CORE ============ */}
          <text x={40} y={BAND_B_Y - 88} fill={C.dim} fontSize={12 * fs} letterSpacing={4} className="font-display">
            ROUTE TO THE CORE
          </text>
          <text x={40} y={BAND_B_Y - 71} fill={C.faint} fontSize={10.5 * fs}>
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
                fill={routeDotColor.get(p.r) ?? C.white} opacity={0.45 + (p.rank % 4) * 0.12} />
            </g>
          ))}

          {inputs.routeLandmarks
            .filter((p) => Math.abs(bx(p.s) - bx(stars)) > 150)
            .map((p, i) => (
              <g key={p.r}>
                <line x1={bx(p.s)} y1={BAND_B_Y + 6} x2={bx(p.s)} y2={BAND_B_Y + 26 + (i % 2) * 13}
                  stroke={C.grid} strokeWidth={1} />
                <text x={bx(p.s)} y={BAND_B_Y + 38 + (i % 2) * 13} fill={C.dim} fontSize={11 * fs}
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
              <text x={bx(m.threshold)} y={BAND_B_Y - 20} fill={C.dim} fontSize={11 * fs}
                textAnchor="middle">
                TOP {m.rank}
              </text>
              <text x={bx(m.threshold)} y={BAND_B_Y - 32} fill={C.faint} fontSize={10.5 * fs}
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
              <text x={bx(inputs.home.s)} y={BAND_B_Y + 64} fill={C.accent} fontSize={11 * fs}
                textAnchor="middle" opacity={0.9}>
                ⌂ {trunc(shortName(inputs.home.r))}
              </text>
            </g>
          ) : null}

          {[...inputs.milestones].sort((a, b) => b.rank - a.rank).map((m) => (
            <g key={m.rank}>
              <circle cx={bx(m.at ?? m.threshold)} cy={BAND_B_Y} r={5} fill="none" stroke={C.accent}
                strokeWidth={1} opacity={0.85} />
              <circle cx={bx(m.at ?? m.threshold)} cy={BAND_B_Y} r={1.6} fill={C.accent} />
              <text x={bx(m.at ?? m.threshold)} y={BAND_B_Y - 20} fill={C.ink} fontSize={11.5 * fs}
                textAnchor="middle">
                TOP {m.rank}
              </text>
              <text x={bx(m.at ?? m.threshold)} y={BAND_B_Y - 32} fill={C.faint} fontSize={10.5 * fs}
                textAnchor="middle">
                {fmtCompact(m.threshold)}
              </text>
            </g>
          ))}

          {apex ? (
            <g className="core-glow">
              <circle cx={bx(coreStars)} cy={BAND_B_Y} r={26} fill="url(#coreGrad)" />
              <circle cx={bx(coreStars)} cy={BAND_B_Y} r={3.4} fill={C.white} />
              <text x={bx(coreStars)} y={BAND_B_Y - 36} fill={C.white} fontSize={12 * fs}
                textAnchor="end" fontWeight={700}>
                GALACTIC CORE
              </text>
              <text x={bx(coreStars)} y={BAND_B_Y - 24} fill={C.dim} fontSize={11 * fs}
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
              <text x={bx(origin.s)} y={BAND_B_Y + 52} fill={C.accent} fontSize={11 * fs}
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
            <text x={Math.max(40, bx(stars) - 6)} y={BAND_B_Y + 22} fill={C.white} fontSize={11.5 * fs}
              textAnchor="start">
              you are here{rank ? ` · #${rank}` : ""}
            </text>
          </g>
        </svg>

        {scan ? (
          <div
            className="scan-card hud z-10 w-[310px] px-4 py-3"
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
            <ScanContent
              scan={scan}
              ownV={vOwn}
              nowMs={nowMs}
              rank={
                scan.kind === "route"
                  ? scan.p.rank
                  : inputs.routeAll.find((p) => p.r.toLowerCase() === scan.n.r.toLowerCase())?.rank ?? null
              }
            />
            <div className="mt-2 flex items-center gap-2 border-t border-grid pt-2">
              <Link
                prefetch
                href={`/r/${scan.kind === "neighbor" ? scan.n.r : scan.p.r}#from=${encodeURIComponent(inputs.repo)}`}
                className="numeral flex-1 border border-accent/40 px-2 py-1 text-center text-micro tracking-[0.18em] text-accent transition-colors hover:bg-accent/10"
              >
                OPEN SCAN
              </Link>
              {onPinTarget ? (
                <button
                  onClick={() => togglePin(scan.kind === "neighbor" ? scan.n.r : scan.p.r)}
                  className="numeral flex-1 border border-grid px-2 py-1 text-micro tracking-[0.18em] text-dim transition-colors hover:text-ink"
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

function ScanContent({ scan, ownV, nowMs, rank }: { scan: Scan; ownV: number; nowMs: number; rank: number | null }) {
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
        <span className="font-display text-micro tracking-[0.3em] text-dim">SCAN</span>
        <span className={`numeral text-micro tracking-[0.15em] ${statusColor}`}>{status}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ghAvatar(owner, 64)}
          alt=""
          width={26}
          height={26}
          className="h-[26px] w-[26px] border border-grid"
        />
        <div className="min-w-0">
          <div className="numeral truncate text-data font-semibold text-star">{full}</div>
          {lang ? <div className="numeral text-micro text-dim">{lang}</div> : null}
        </div>
      </div>
      {desc ? (
        <p className="mt-1.5 line-clamp-2 text-label font-light leading-snug text-dim">{desc}</p>
      ) : null}
      <div className="numeral mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-grid pt-2 text-label">
        <Row k="stars" v={fmt(scan.kind === "neighbor" ? scan.n.s : scan.p.s)} />
        {scan.kind === "neighbor" && rank !== null ? <Row k="rank" v={`#${fmt(rank)}`} /> : null}
        {scan.kind === "route" && scan.p.v != null ? (
          <Row k="velocity" v={`${Math.round(scan.p.v)}/day`} />
        ) : null}
        {scan.kind === "neighbor" ? (
          <>
            <Row k="velocity" v={`${Math.round(scan.n.v)}/day`} />
            <Row
              k="rel v"
              v={(() => {
                const relPct = Math.round((scan.n.v / Math.max(ownV, 1) - 1) * 100);
                return `${relPct >= 0 ? "+" : ""}${relPct}% vs us`;
              })()}
            />
            <Row k="gap" v={fmtSignedGap(scan.n.gap)} />
            <Row k="closing" v={`${scan.n.closing >= 0 ? "+" : ""}${Math.round(scan.n.closing)}/day`} />
            <Row
              k="overtake"
              v={
                scan.n.gap <= 0
                  ? "done"
                  : scan.n.etaDays !== null
                    ? `${fmtEtaRange(scan.n.etaDays, scan.n.etaRange)} · ${etaDate(scan.n.etaDays, new Date(nowMs)) ?? ""}`
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
