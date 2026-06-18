// Deep-space backdrops with PAGE CHARACTER: the same visual language as the
// charts (cruise drift, FTL streaks, doppler tints, gold = the living
// present), choreographed differently per page so the sky tells you where
// you are:
//   scan     (landing/explore) — open space; lone ships jump to warp
//   launch   (pricing)         — tracked missions breathe; a golden growth
//                                curve rehearses a launch
//   raceway  (velocity)        — traffic crosses toward the core at three
//                                depths, near lanes fast and hot
// Pure CSS animation, seeded (stable across builds), pointer-transparent,
// honors reduced motion. Zero client JS.
function seeded(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let seed = h >>> 0;
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 1600;
const H = 900;

// quantize coordinates: full-precision floats (451.89037434756756) bloat the
// server HTML and its parse for no visual gain — sub-pixel rounding is invisible
const q = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export type BackdropMode = "scan" | "launch" | "raceway";

export default function SpaceBackdrop({ mode = "scan" }: { mode?: BackdropMode }) {
  const rand = seeded(`warpchart::backdrop::${mode}`);
  const layer = (n: number, rA: number, rB: number, oA: number, oB: number) =>
    Array.from({ length: n }, () => ({
      x: q(rand() * W),
      y: q(rand() * H),
      r: q(rA + rand() * (rB - rA), 2),
      o: q(oA + rand() * (oB - oA), 2),
      tw: rand() < 0.3,
    }));
  // launch sits almost still (the calm before ignition); raceway's field is
  // calm too so the crossing traffic owns all the motion
  const driftScale = mode === "scan" ? 1 : 2.6;
  const layers = [
    { stars: layer(90, 0.6, 1.2, 0.18, 0.42), dur: 420 * driftScale },
    { stars: layer(60, 0.9, 1.7, 0.25, 0.55), dur: 240 * driftScale },
    { stars: layer(36, 1.2, 2.4, 0.35, 0.75), dur: 130 * driftScale },
  ];
  // a few bright named-feeling stars with a soft halo, the field's anchors
  const heroes = Array.from({ length: 7 }, () => ({
    x: q(rand() * W),
    y: q(rand() * H),
    r: q(1.8 + rand() * 1.4, 2),
    warm: rand() < 0.25,
  }));

  // scan: lone ships stretching into warp somewhere out there
  const streaks =
    mode === "scan"
      ? Array.from({ length: 6 }, (_, i) => ({
          x: rand() * (W * 0.55),
          y: 60 + rand() * (H - 160),
          len: 90 + rand() * 140,
          dur: 10 + rand() * 7,
          delay: i * 3.1 + rand() * 2,
        }))
      : [];

  // launch: a handful of tracked missions, composed toward the edges so the
  // pricing cards keep the center stage
  const pings =
    mode === "launch"
      ? Array.from({ length: 6 }, (_, i) => ({
          x: (i % 2 === 0 ? 0.04 + rand() * 0.22 : 0.74 + rand() * 0.22) * W,
          y: (0.12 + rand() * 0.72) * H,
          r: 14 + rand() * 12,
          warm: i % 3 !== 2, // gold majority, a couple of cyan escorts
          dur: 7 + rand() * 5,
          delay: i * 1.9 + rand() * 2,
        }))
      : [];

  // raceway: nine lanes at three depths, all flowing toward the core
  const lanes =
    mode === "raceway"
      ? Array.from({ length: 9 }, (_, i) => {
          const depth = i < 3 ? "far" : i < 7 ? "mid" : "near";
          return {
            depth,
            y: 40 + rand() * (H - 120),
            len: depth === "far" ? 70 + rand() * 60 : depth === "mid" ? 130 + rand() * 100 : 220 + rand() * 140,
            h: depth === "far" ? 1.1 : depth === "mid" ? 1.7 : 2.6,
            dur: depth === "far" ? 17 + rand() * 6 : depth === "mid" ? 9 + rand() * 4 : 5.5 + rand() * 1.5,
            delay: i * 1.7 + rand() * 3,
            op: depth === "far" ? 0.35 : depth === "mid" ? 0.6 : 0.9,
            warm: depth === "near" && i === 8, // one hot lane falling behind us
          };
        })
      : [];

  return (
    <svg
      aria-hidden
      // z must sit ABOVE the global .space-backdrop (-2): below it the whole
      // sky paints behind an opaque background and nobody ever sees it
      className="pointer-events-none fixed inset-0 z-[-1] h-full w-full"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id="bk-cool">
          <stop offset="0%" stopColor="var(--star-white)" stopOpacity="0.8" />
          <stop offset="35%" stopColor="var(--accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="bk-warm">
          <stop offset="0%" stopColor="var(--star-white)" stopOpacity="0.7" />
          <stop offset="40%" stopColor="var(--warn)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--warn)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bk-streak" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--star-white)" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="bk-streak-warm" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--warn)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--star-white)" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="bk-streak-far" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--star-white)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--star-white)" stopOpacity="0.7" />
        </linearGradient>
      </defs>

      {/* a faint milky way band crossing the field diagonally */}
      <ellipse cx={W * 0.5} cy={H * 0.42} rx={W * 0.72} ry={120}
        transform={`rotate(-16 ${W * 0.5} ${H * 0.42})`} fill="url(#bk-cool)" opacity={0.16} />

      {/* distant galaxies, pinned: infinite distance, zero parallax */}
      <ellipse cx={W * 0.82} cy={H * 0.18} rx={70} ry={18}
        transform={`rotate(-24 ${W * 0.82} ${H * 0.18})`} fill="url(#bk-cool)" opacity={0.4} />
      <ellipse cx={W * 0.12} cy={H * 0.78} rx={52} ry={13}
        transform={`rotate(18 ${W * 0.12} ${H * 0.78})`} fill="url(#bk-warm)" opacity={0.35} />

      {layers.map((l, li) => (
        <g key={li} className="lnd-drift" style={{ animationDuration: `${l.dur}s` }}>
          {[0, W].map((dx) => (
            <g key={dx} transform={`translate(${dx} 0)`}>
              {l.stars.map((s, i) => (
                <circle key={i} className={s.tw ? "dust-tw" : undefined}
                  cx={s.x} cy={s.y} r={s.r} fill="var(--star-white)" opacity={s.o} />
              ))}
            </g>
          ))}
        </g>
      ))}

      {/* anchor stars: bright cores with a soft halo, pinned (no drift) */}
      {heroes.map((s, i) => (
        <g key={i}>
          <circle cx={s.x} cy={s.y} r={s.r * 4.5}
            fill={s.warm ? "url(#bk-warm)" : "url(#bk-cool)"} opacity={0.5} />
          <circle className="dust-tw" cx={s.x} cy={s.y} r={s.r}
            fill="var(--star-white)" opacity={0.85} />
        </g>
      ))}

      {streaks.map((s, i) => (
        <rect key={i} className="lnd-streak" x={s.x} y={s.y} width={s.len} height={1.4}
          rx={0.7} fill="url(#bk-streak)"
          style={{ animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }} />
      ))}

      {pings.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={1.6} fill={p.warm ? "var(--warn)" : "var(--accent)"} opacity={0.55} />
          <circle
            className="bk-ping"
            cx={p.x} cy={p.y} r={p.r}
            fill="none" stroke={p.warm ? "var(--warn)" : "var(--accent)"} strokeWidth={1.3}
            style={{ "--dur": `${p.dur}s`, "--delay": `${p.delay}s` } as React.CSSProperties}
          />
        </g>
      ))}

      {mode === "launch" ? (
        // the rehearsal: a growth curve igniting from the lower left,
        // climbing into the upper right, resting, letting go
        <path
          className="bk-traj"
          d={`M ${W * 0.05} ${H * 0.9}
              C ${W * 0.4} ${H * 0.88}, ${W * 0.58} ${H * 0.8}, ${W * 0.72} ${H * 0.62}
              S ${W * 0.9} ${H * 0.28}, ${W * 0.96} ${H * 0.12}`}
          fill="none" stroke="var(--warn)" strokeWidth={1.6} strokeLinecap="round"
          style={{ "--len": 1900 } as React.CSSProperties}
        />
      ) : null}

      {lanes.map((l, i) => (
        <rect
          key={i}
          className="bk-pass"
          x={0} y={l.y} width={l.len} height={l.h} rx={l.h / 2}
          fill={l.warm ? "url(#bk-streak-warm)" : l.depth === "far" ? "url(#bk-streak-far)" : "url(#bk-streak)"}
          style={{ "--dur": `${l.dur}s`, "--delay": `${l.delay}s`, "--op": l.op } as React.CSSProperties}
        />
      ))}
    </svg>
  );
}
