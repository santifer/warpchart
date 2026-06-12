"use client";

// Partially isometric galaxy hero. The isometry itself is pre-projected into
// the SVG coordinates (squash + log radii in lib/galaxy), so labels stay
// crisp and horizontal; on top of that a REAL 3D micro-tilt (CSS perspective
// + translateZ-separated layers) follows the pointer, which is what makes the
// dust, the rings and the systems parallax against each other.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  GX_W,
  GX_H,
  GX_CORE_X,
  GX_CORE_Y,
  projectGalaxy,
  ringPath,
  ringPoint,
  type GalaxyData,
} from "@/lib/galaxy";

declare global {
  interface Window {
    // search box -> galaxy bridge: warp to a repo's real position
    __gxWarpTo?: (repo: string, stars?: number) => boolean;
  }
}

const WARP_MS = 640;

export default function GalaxyHero({ data }: { data: GalaxyData }) {
  const router = useRouter();
  const planeRef = useRef<HTMLDivElement>(null);
  const warping = useRef(false);

  useEffect(() => {
    const el = planeRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    let raf = 0;
    let cx = 0,
      cy = 0,
      tx = 0,
      ty = 0;
    const step = () => {
      cx += (tx - cx) * 0.07;
      cy += (ty - cy) * 0.07;
      el.style.setProperty("--gxy", `${(cx * 2.6).toFixed(3)}deg`);
      el.style.setProperty("--gxx", `${(-cy * 1.8).toFixed(3)}deg`);
      raf =
        Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001
          ? requestAnimationFrame(step)
          : 0;
    };
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = (e.clientY / window.innerHeight) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(step);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // the jump: dive toward the star (css zoom on the plane, the headline
  // column fades), then navigate with the "warp" transition type so the
  // route change itself plays the warp-out/warp-in view transition. the
  // calculation time of /r/ hides inside the travel.
  const warpTo = (repo: string, point: { x: number; y: number } | null) => {
    if (warping.current) return;
    const el = planeRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || !point || reduced) {
      router.push(`/r/${repo}`, { transitionTypes: ["warp"] });
      return;
    }
    warping.current = true;
    el.style.setProperty("--gx-ox", `${((point.x / GX_W) * 100).toFixed(2)}%`);
    el.style.setProperty("--gx-oy", `${((point.y / GX_H) * 100).toFixed(2)}%`);
    document.body.classList.add("gx-warping");
    window.setTimeout(() => {
      router.push(`/r/${repo}`, { transitionTypes: ["warp"] });
    }, WARP_MS);
  };

  // landing search picks ride the same jump: project the repo's REAL
  // position from its stars (works for any catalog repo, node or dust);
  // deep-space repos aren't on the map, so they dive toward the core
  useEffect(() => {
    window.__gxWarpTo = (repo: string, stars?: number) => {
      const point = stars
        ? projectGalaxy(repo, stars, data.scale.coreStars, data.scale.floorStars)
        : { x: GX_CORE_X, y: GX_CORE_Y };
      warpTo(repo, point);
      return true;
    };
    // returning to the landing (back button / bfcache) must undo the dive
    document.body.classList.remove("gx-warping");
    const onShow = () => {
      warping.current = false;
      document.body.classList.remove("gx-warping");
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      delete window.__gxWarpTo;
      window.removeEventListener("pageshow", onShow);
      document.body.classList.remove("gx-warping");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.scale.coreStars, data.scale.floorStars]);

  const go = (e: React.MouseEvent, repo: string, point: { x: number; y: number } | null) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    warpTo(repo, point);
  };

  return (
    <div className="ghx-stage">
      <div ref={planeRef} className="ghx-plane">
        {/* far layer: the full top 1000 as dust, every grain a real repo at
            its real log position; non-interactive on purpose */}
        <svg className="ghx-layer ghx-far" viewBox={`0 0 ${GX_W} ${GX_H}`} aria-hidden>
          {data.dust.map(([x, y, s, o], i) => (
            <circle key={i} cx={x} cy={y} r={s / 10} fill="var(--accent)" opacity={o / 100} />
          ))}
        </svg>

        {/* mid layer: core halo + gate rings (the navigation chart) */}
        <svg className="ghx-layer ghx-mid" viewBox={`0 0 ${GX_W} ${GX_H}`} aria-hidden>
          <defs>
            <radialGradient id="ghxHalo">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </radialGradient>
            <radialGradient id="ghxCoreGlow">
              <stop offset="0%" stopColor="var(--warn)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--warn)" stopOpacity={0} />
            </radialGradient>
          </defs>
          {/* both glows are sized/offset so their gradients die out BEFORE
              the svg's top edge; a taller ellipse would get sliced into a
              hard horizontal chord by the viewBox */}
          <ellipse cx={1308} cy={170} rx={470} ry={168} fill="url(#ghxHalo)" />
          <ellipse cx={GX_CORE_X} cy={GX_CORE_Y} rx={190} ry={76} fill="url(#ghxCoreGlow)" />
          {data.rings.map((g) => {
            const lp = ringPoint(g.radius, 244);
            return (
              <g key={g.label}>
                <path className="ghx-ring" d={ringPath(g.radius)} />
                <text className="ghx-ring-label numeral" x={lp.x + 6} y={lp.y + 14}>
                  {g.label}
                </text>
              </g>
            );
          })}
        </svg>

        {/* near layer: interactive systems, each a real clickable repo */}
        <svg
          className="ghx-layer ghx-near"
          viewBox={`0 0 ${GX_W} ${GX_H}`}
          role="group"
          aria-label="Star map of the GitHub top 1000: each light is a real repository"
        >
          {data.nodes.map((n, i) => (
            <a
              key={n.r}
              href={`/r/${n.r}`}
              className="ghx-node"
              data-repo={n.r}
              aria-label={`${n.r}, ${n.tip.replaceAll("·", ",")}`}
              onClick={(e) => go(e, n.r, { x: n.x, y: n.y })}
              onPointerEnter={(e) => {
                // svg paints in dom order: bring the hovered system to the
                // front so its tip is never crossed by sibling dots (the
                // node list is static, so react never fights this)
                const el = e.currentTarget;
                el.parentNode?.appendChild(el);
              }}
            >
              <circle cx={n.x} cy={n.y} r={13} fill="transparent" />
              {n.hot ? (
                <circle
                  className="ghx-ping"
                  cx={n.x}
                  cy={n.y}
                  r={n.size + 3}
                  style={{ "--d": `${(i % 7) * 0.45}s` } as React.CSSProperties}
                />
              ) : null}
              <circle
                className="ghx-dot"
                cx={n.x}
                cy={n.y}
                r={n.size}
                fill={n.hot ? "var(--warn)" : n.anchor ? "var(--star-white)" : "var(--accent)"}
                opacity={0.62 + (1 - n.depth) * 0.33}
              />
              {n.anchor ? (
                <text
                  className="ghx-name numeral"
                  x={n.x > GX_W - 180 ? n.x - 9 : n.x + 9}
                  y={n.y + 4}
                  textAnchor={n.x > GX_W - 180 ? "end" : "start"}
                >
                  {n.label}
                </text>
              ) : null}
              <g className="ghx-tip">
                <text
                  x={n.x > GX_W - 260 ? n.x - 12 : n.x + 12}
                  y={n.y + 4}
                  textAnchor={n.x > GX_W - 260 ? "end" : "start"}
                >
                  {n.label} <tspan>{n.tip}</tspan>
                </text>
              </g>
            </a>
          ))}
        </svg>

        {/* the core: rank #1, the destination of every mission */}
        <a
          href={`/r/${data.core.r}`}
          className="ghx-core"
          onClick={(e) => go(e, data.core.r, { x: GX_CORE_X, y: GX_CORE_Y })}
          aria-label={`The core: ${data.core.r}, rank 1`}
          style={{
            left: `${((GX_CORE_X / GX_W) * 100).toFixed(2)}%`,
            top: `${((GX_CORE_Y / GX_H) * 100).toFixed(2)}%`,
          }}
        >
          <span className="ghx-core-glow" aria-hidden />
          <span className="ghx-core-label numeral">
            THE CORE ◆ {data.core.label}
            <br />
            <span className="ghx-core-tip">{data.core.tip}</span>
          </span>
        </a>
      </div>

      {/* scrims keep the headline legible without dimming the core side */}
      <div className="ghx-scrim" aria-hidden />
      <span className="ghx-lore numeral" aria-hidden>
        a galaxy of systems, each pulled by its stars · every light is real
      </span>
    </div>
  );
}
