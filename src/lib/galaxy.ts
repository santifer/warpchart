// Galaxy hero geometry: the real top-1000 catalog projected onto a partially
// isometric star map. The core (rank #1) sits in the top-right corner and
// every other system fans out along the 200-250 degree arc at its real
// log10(stars) distance from the core. The angle is the one free dimension
// (the ranking is 1D), so it is a per-repo deterministic spread: a system
// never moves between builds, which phase C (zoom-to-system) relies on.
// Pure module: imported by the server (data prep) and the client (ring paths,
// phase C focus math). No fs, no React.
import { fmtCompact } from "@/lib/format";
import { canonicalVel0 } from "@/lib/velocity";

export const GX_W = 1560;
export const GX_H = 640;
export const GX_CORE_X = 1492;
export const GX_CORE_Y = 78;
// partial isometry: the galactic disc seen at an angle, not top-down
export const GX_SQUASH = 0.5;
const FAN_FROM = 200; // degrees, math convention with y flipped for screen
// 200 -> 264: sweeps from the left almost to straight-down-from-the-core
// (6 degrees shy of vertical), filling the lower-right quadrant that a
// 250-degree cap left dead
const FAN_SPAN = 64;
const R_MIN = 64;
// capped by the canvas at the fan's most vertical edge: radius is pure
// log(stars) and can never depend on angle, so the whole scale shares it
const R_MAX = 1110;
const MIN_NODE_GAP = 26; // px between interactive systems (label air)
const MAX_NODES = 130;

export type GalaxyNode = {
  r: string;
  rank: number;
  x: number;
  y: number;
  depth: number; // 0 at the core's doorstep, 1 at the top-1000 edge
  size: number;
  hot: boolean; // fast mover today
  anchor: boolean; // famous head-of-ranking system with a permanent label
  me: boolean; // the house mission: subtly set apart among the anchors
  label: string; // short name
  tip: string; // hover readout: rank, stars, velocity
};
// x, y, size*10, opacity*100 (kept numeric so 900 grains stay light on the wire)
export type GalaxyDust = [number, number, number, number];
export type GalaxyRing = { radius: number; label: string };
export type GalaxyData = {
  core: { r: string; label: string; tip: string };
  nodes: GalaxyNode[];
  dust: GalaxyDust[];
  rings: GalaxyRing[];
  // log-scale endpoints so the client can project ANY catalog repo (the
  // search box warps to systems that aren't interactive nodes)
  scale: { coreStars: number; floorStars: number };
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function logScale(coreStars: number, floorStars: number) {
  const top = Math.log10(Math.max(coreStars, 10));
  const span = Math.max(0.2, top - Math.log10(Math.max(floorStars, 2)));
  return (stars: number) => {
    const t = Math.min(1, Math.max(0, (top - Math.log10(Math.max(stars, 2))) / span));
    return { radius: R_MIN + t * (R_MAX - R_MIN), depth: t };
  };
}

export function projectGalaxy(
  repo: string,
  stars: number,
  coreStars: number,
  floorStars: number,
): { x: number; y: number; depth: number; jitter: number } {
  const { radius, depth } = logScale(coreStars, floorStars)(stars);
  const rand = mulberry32(seedFrom("gx::" + repo));
  const theta = ((FAN_FROM + rand() * FAN_SPAN) * Math.PI) / 180;
  return {
    x: GX_CORE_X + radius * Math.cos(theta),
    y: GX_CORE_Y - radius * Math.sin(theta) * GX_SQUASH,
    depth,
    jitter: rand(),
  };
}

// gate ring around the core, clipped to the fan (plus a little overhang)
export function ringPath(radius: number): string {
  const pts: string[] = [];
  for (let deg = FAN_FROM - 3; deg <= FAN_FROM + FAN_SPAN + 3; deg += 2.5) {
    const a = (deg * Math.PI) / 180;
    const x = GX_CORE_X + radius * Math.cos(a);
    const y = GX_CORE_Y - radius * Math.sin(a) * GX_SQUASH;
    pts.push(`${pts.length ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

// point on a ring at a given fan angle (ring labels, phase C waypoints)
export function ringPoint(radius: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return {
    x: GX_CORE_X + radius * Math.cos(a),
    y: GX_CORE_Y - radius * Math.sin(a) * GX_SQUASH,
  };
}

// a system's TRUE galactic angle (squash undone), degrees in [0, 360).
// the warp dive rotates the galaxy by (angle - 180) while unsquashing, so
// the system->core line lands exactly horizontal, core to the right: the
// same geometry the /r/ chart opens with (match cut)
export function galaxyAngle(x: number, y: number): number {
  const deg =
    (Math.atan2((GX_CORE_Y - y) / GX_SQUASH, x - GX_CORE_X) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function buildGalaxy(
  repos: { r: string; s: number; v?: number | null; v7?: number | null }[],
  homeRepo?: string | null,
  daySeed?: string,
): GalaxyData {
  const core = repos[0];
  const floor = repos[repos.length - 1];
  const scale = logScale(core.s, floor.s);
  const rankOf = new Map(repos.map((p, i) => [p.r, i + 1]));
  const proj = (p: { r: string; s: number }) => projectGalaxy(p.r, p.s, core.s, floor.s);

  // candidates in priority order: the head of the ranking (the famous names
  // everyone recognizes), today's fastest movers, then a depth-spaced sweep
  // so the whole fan is inhabited, not just the bulge near the core
  const head = repos.slice(1, 16);
  // canonical velocity (7-day v7, ~1-day v fallback): "today's fastest movers"
  // selected and labelled on the stable rate, matching every other surface.
  const cvel = canonicalVel0;
  const hotSet = new Set(
    repos
      .slice(16)
      .filter((p) => cvel(p) >= 150)
      .sort((a, b) => cvel(b) - cvel(a))
      .slice(0, 10)
      .map((p) => p.r),
  );
  const taken = new Set<string>([core.r, ...head.map((p) => p.r), ...hotSet]);
  const sweep: typeof repos = [];
  for (let i = 0; i < 110; i++) {
    const target = (i + 1) / 111;
    let best: (typeof repos)[number] | null = null;
    let bestGap = Infinity;
    for (const p of repos) {
      if (taken.has(p.r)) continue;
      const gap = Math.abs(scale(p.s).depth - target);
      if (gap < bestGap) {
        bestGap = gap;
        best = p;
      }
    }
    if (best) {
      taken.add(best.r);
      sweep.push(best);
    }
  }

  const nodes: GalaxyNode[] = [];
  const tryAccept = (p: { r: string; s: number; v?: number | null; v7?: number | null }) => {
    if (nodes.length >= MAX_NODES) return;
    const q = proj(p);
    for (const n of nodes) {
      const dx = n.x - q.x;
      const dy = n.y - q.y;
      if (dx * dx + dy * dy < MIN_NODE_GAP * MIN_NODE_GAP) return;
    }
    const hot = hotSet.has(p.r);
    const rank = rankOf.get(p.r) ?? 0;
    const cv = cvel(p);
    nodes.push({
      r: p.r,
      rank,
      x: Math.round(q.x * 10) / 10,
      y: Math.round(q.y * 10) / 10,
      depth: Math.round(q.depth * 100) / 100,
      size: Math.round((2.1 + (1 - q.depth) * 1.9 + (hot ? 0.6 : 0)) * 10) / 10,
      hot,
      anchor: false,
      me: false,
      label: p.r.split("/")[1] ?? p.r,
      tip:
        `#${rank} · ${fmtCompact(p.s)} ★` +
        (hot && cv ? ` · +${Math.round(cv)}/day` : ""),
    });
  };
  for (const p of head) tryAccept(p);
  for (const p of repos) if (hotSet.has(p.r)) tryAccept(p);
  // the house mission always makes the map (bypassing the spacing check),
  // marked so the hero can set it apart with its own quiet signature
  const home = homeRepo
    ? repos.find((p) => p.r.toLowerCase() === homeRepo.toLowerCase())
    : null;
  if (home && home.r !== core.r) {
    const had = nodes.length;
    tryAccept(home);
    let mine = nodes.find((n) => n.r === home.r);
    if (!mine && had === nodes.length) {
      const q = proj(home);
      mine = {
        r: home.r,
        rank: rankOf.get(home.r) ?? 0,
        x: Math.round(q.x * 10) / 10,
        y: Math.round(q.y * 10) / 10,
        depth: Math.round(q.depth * 100) / 100,
        size: Math.round((2.1 + (1 - q.depth) * 1.9) * 10) / 10,
        hot: false,
        anchor: false,
        me: false,
        label: home.r.split("/")[1] ?? home.r,
        tip: `#${rankOf.get(home.r) ?? 0} · ${fmtCompact(home.s)} ★`,
      };
      nodes.push(mine);
    }
    if (mine) {
      mine.me = true;
      mine.anchor = true;
    }
  }
  for (const p of sweep) tryAccept(p);

  // permanent labels read as "today's featured systems": half are the
  // best-ranked giants (recognition), half rotate daily from the wider
  // accepted pool (freshness, and nobody looks like a permanent favorite);
  // hot movers already announce themselves, the house keeps its ring
  const pool = [...nodes]
    .filter((n) => !n.hot && !n.me && !(n.y < 170 && n.x > 1080))
    .sort((a, b) => a.rank - b.rank);
  const giants = pool.slice(0, 12);
  const dayRand = mulberry32(seedFrom("anchors::" + (daySeed ?? "")));
  const rotating = pool
    .slice(12)
    .filter((n) => n.rank <= 600)
    .map((n) => ({ n, k: dayRand() }))
    .sort((a, b) => a.k - b.k)
    .map((e) => e.n);
  const anchored: GalaxyNode[] = nodes.filter((n) => n.me);
  const tryAnchor = (n: GalaxyNode, cap: number) => {
    if (anchored.length >= cap) return;
    if (anchored.every((a) => (a.x - n.x) ** 2 + (a.y - n.y) ** 2 > 72 * 72)) {
      n.anchor = true;
      anchored.push(n);
    }
  };
  for (const n of giants) tryAnchor(n, 5); // home + 4 giants
  for (const n of rotating) tryAnchor(n, 9); // + 4 daily picks
  for (const n of giants) tryAnchor(n, 9); // backfill if rotation collided

  // everything not interactive is dust: the rest of the real top 1000
  const nodeSet = new Set(nodes.map((n) => n.r));
  const dust: GalaxyDust[] = [];
  for (const p of repos) {
    if (p.r === core.r || nodeSet.has(p.r)) continue;
    const q = proj(p);
    dust.push([
      Math.round(q.x),
      Math.round(q.y),
      Math.round((0.7 + q.jitter * 0.7) * 10),
      Math.round((0.18 + (1 - q.depth) * 0.3) * 100),
    ]);
  }

  // gates: rank thresholds drawn as navigation rings around the core
  const rings: GalaxyRing[] = [10, 100, 500, 1000]
    .filter((n) => n <= repos.length)
    .map((n) => ({
      radius: Math.round(scale(repos[n - 1].s).radius),
      label: `TOP ${n}`,
    }));

  return {
    core: {
      r: core.r,
      label: core.r.split("/")[1] ?? core.r,
      tip: `#1 · ${fmtCompact(core.s)} ★`,
    },
    nodes,
    dust,
    rings,
    scale: { coreStars: core.s, floorStars: floor.s },
  };
}
