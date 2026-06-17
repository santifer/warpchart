"use client";

// Partially isometric galaxy hero. The isometry itself is pre-projected into
// the SVG coordinates (squash + log radii in lib/galaxy), so labels stay
// crisp and horizontal; on top of that the pointer drives a LOCAL ZOOM: the
// neighborhood under the cursor leans in (no rotation, the galaxy's angle
// never changes), and each layer zooms by a different factor so depth reads
// as the dust lagging behind the systems.
import { useEffect, useRef, useState } from "react";
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

export default function GalaxyHero({ data }: { data: GalaxyData }) {
  const router = useRouter();
  const planeRef = useRef<HTMLDivElement>(null);
  const warping = useRef(false);
  const prefetched = useRef(new Set<string>());
  const [immersive, setImmersive] = useState(false);
  // auto-fullscreen fires at most ONCE per session and is disarmed the moment
  // the viewer enters (auto or by the chip), so it never fights a manual exit
  const autoFsArmed = useRef(true);

  // FULLSCREEN: promotes the star map to a viewport overlay. The page's own
  // fixed backdrop (grid, bluish wash, starfield) shows straight through — the
  // body.gx-fullscreen class just fades the rest of the page out. Lock scroll
  // and let ESC dismiss it while it is open.
  useEffect(() => {
    if (!immersive) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    document.body.classList.add("gx-fullscreen");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImmersive(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = prev;
      document.body.classList.remove("gx-fullscreen");
      window.removeEventListener("keydown", onKey);
    };
  }, [immersive]);

  useEffect(() => {
    const el = planeRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    let raf = 0;
    // zoom factor (0 = resting, ZMAX = leaning in) and its origin, all
    // lerped so the neighborhood swims toward the cursor instead of snapping
    const ZMAX = 0.34;
    let zf = 0,
      zx = 60,
      zy = 40,
      tzf = 0,
      tzx = 60,
      tzy = 40;
    const step = () => {
      zf += (tzf - zf) * 0.08;
      zx += (tzx - zx) * 0.1;
      zy += (tzy - zy) * 0.1;
      el.style.setProperty("--gx-zf", zf.toFixed(4));
      el.style.setProperty("--gx-zx", `${zx.toFixed(2)}%`);
      el.style.setProperty("--gx-zy", `${zy.toFixed(2)}%`);
      raf =
        Math.abs(tzf - zf) > 0.0005 || Math.abs(tzx - zx) > 0.05 || Math.abs(tzy - zy) > 0.05
          ? requestAnimationFrame(step)
          : 0;
    };
    // immersion: after dwelling on the map a while, the headline column
    // steps back (dims via body class) so the galaxy takes the stage; the
    // moment the pointer leaves the map it returns to full strength
    let dwell = 0;
    let fsTimer = 0;
    const onMove = (e: PointerEvent) => {
      if (warping.current) return;
      const r = el.getBoundingClientRect();
      tzx = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
      tzy = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100));
      tzf = ZMAX;
      if (!raf) raf = requestAnimationFrame(step);
      if (!dwell && !document.body.classList.contains("gx-immersed")) {
        dwell = window.setTimeout(() => {
          document.body.classList.add("gx-immersed");
        }, 1400);
      }
      // sustained engagement escalates to fullscreen on its own — but only once
      // per session, only near the top of the page (never yank a reader who has
      // scrolled down), and never while warping. Leaving the map cancels it.
      // The effect already bailed for reduced-motion / coarse pointers above,
      // so this only ever runs on a deliberate desktop hover.
      if (!fsTimer && autoFsArmed.current) {
        fsTimer = window.setTimeout(() => {
          if (autoFsArmed.current && window.scrollY < 60 && !warping.current) {
            autoFsArmed.current = false;
            setImmersive(true);
          }
        }, 4500);
      }
    };
    const onLeave = () => {
      tzf = 0;
      if (!raf) raf = requestAnimationFrame(step);
      if (dwell) {
        clearTimeout(dwell);
        dwell = 0;
      }
      if (fsTimer) {
        clearTimeout(fsTimer);
        fsTimer = 0;
      }
      document.body.classList.remove("gx-immersed");
    };
    // the map plane only: hovering the headline column (which sits on top
    // and swallows its own pointer events) must never lean the galaxy in
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
      if (dwell) clearTimeout(dwell);
      document.body.classList.remove("gx-immersed");
    };
  }, []);

  // the jump: a pure zoom into the star (no rotation: it warped every dot
  // into tilted ellipses and read as a glitch), lettering fading out while
  // the veil's blur builds. the route change then rides the "warp" view
  // transition, and the navigation fires on animationend so the old-page
  // snapshot IS the dive's final frame.
  const warpTo = (repo: string, point: { x: number; y: number } | null) => {
    if (warping.current) return;
    setImmersive(false); // leaving the system drops the overlay and unlocks scroll
    const el = planeRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const push = () => router.push(`/r/${repo}`, { transitionTypes: ["warp"] });
    if (!el || !point || reduced) {
      push();
      return;
    }
    warping.current = true;
    el.style.willChange = "transform";
    el.style.setProperty("--gx-ox", `${((point.x / GX_W) * 100).toFixed(2)}%`);
    el.style.setProperty("--gx-oy", `${((point.y / GX_H) * 100).toFixed(2)}%`);
    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      push();
    };
    el.addEventListener(
      "animationend",
      (e) => {
        if (e.animationName === "gx-dive") fire();
      },
      { once: true },
    );
    // safety net: if the dive animation never runs, still navigate
    window.setTimeout(fire, 1400);
    document.body.classList.add("gx-warping");
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
    <div className={immersive ? "ghx-stage ghx-immersive" : "ghx-stage"}>
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
            const lp = ringPoint(g.radius, 258);
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
                // hover is intent: prefetch /r/ now so the warp's travel
                // time covers the render, not the network
                if (!prefetched.current.has(n.r)) {
                  prefetched.current.add(n.r);
                  router.prefetch(`/r/${n.r}`);
                }
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
              {n.me ? (
                // the house mission's quiet signature: the only system that
                // wears a steady gold ring
                <circle className="ghx-me-ring" cx={n.x} cy={n.y} r={n.size + 3.5} />
              ) : null}
              <circle
                className="ghx-dot"
                cx={n.x}
                cy={n.y}
                r={n.size}
                fill={
                  n.me
                    ? "var(--star-white)"
                    : n.hot
                      ? "var(--warn)"
                      : n.anchor
                        ? "var(--star-white)"
                        : "var(--accent)"
                }
                opacity={n.me ? 1 : 0.62 + (1 - n.depth) * 0.33}
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

        {/* the core: rank #1, the destination of every mission (wrapped in
            its own layer so it rides the near zoom with the systems) */}
        <div className="ghx-layer ghx-zlnear">
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
      </div>

      {/* motion-blur veil for the dive: a fixed backdrop-filter whose
          OPACITY animates (animating filter blur over ~1000 svg nodes
          re-rasters every frame; this stays on the compositor) */}
      <div className="ghx-warpveil" aria-hidden />

      {/* scrims keep the headline legible without dimming the core side */}
      <div className="ghx-scrim" aria-hidden />
      <span className="ghx-lore numeral" aria-hidden>
        a galaxy of systems, each pulled by its stars · every light is real
      </span>

      {/* fullscreen: a discrete chip expands the map to a viewport overlay; in
          immersive a minimal mission bar (brand + nav + exit) floats on top so
          the menu stays reachable while the galaxy takes the whole screen */}
      {immersive ? (
        <div className="ghx-immersive-bar numeral">
          <a href="/" className="ghx-imm-brand">
            ◆ WARPCHART
          </a>
          <nav className="ghx-imm-nav">
            <a href="/explore">EXPLORE</a>
            <a href="/velocity">RISING</a>
            <a href="/codex">CODEX</a>
          </nav>
          <button
            type="button"
            className="ghx-imm-exit"
            onClick={() => setImmersive(false)}
            aria-label="Exit fullscreen"
          >
            ✕ EXIT
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="ghx-fsbtn numeral"
          onClick={() => {
            autoFsArmed.current = false;
            setImmersive(true);
          }}
          aria-label="Open the galaxy fullscreen"
        >
          <span aria-hidden>⤢</span> FULLSCREEN
        </button>
      )}
    </div>
  );
}
