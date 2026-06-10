// Deep-space backdrop for the landing: three star layers drifting at
// different depths, the occasional FTL streak crossing the field, and two
// faint distant galaxies. Pure CSS animation, seeded (stable across
// builds), pointer-transparent, honors reduced motion.
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

export default function ExploreBackdrop() {
  const rand = seeded("warpchart::landing");
  const layer = (n: number, rA: number, rB: number, oA: number, oB: number) =>
    Array.from({ length: n }, () => ({
      x: rand() * W,
      y: rand() * H,
      r: rA + rand() * (rB - rA),
      o: oA + rand() * (oB - oA),
      tw: rand() < 0.3,
    }));
  const layers = [
    { stars: layer(56, 0.4, 0.9, 0.1, 0.3), dur: 420 },
    { stars: layer(38, 0.6, 1.2, 0.15, 0.4), dur: 240 },
    { stars: layer(22, 0.8, 1.7, 0.2, 0.55), dur: 130 },
  ];
  const streaks = Array.from({ length: 4 }, (_, i) => ({
    x: rand() * (W * 0.5),
    y: 60 + rand() * (H - 160),
    len: 90 + rand() * 130,
    dur: 9 + rand() * 6,
    delay: i * 4.2 + rand() * 2,
  }));

  return (
    <svg
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id="lg-cool">
          <stop offset="0%" stopColor="var(--star-white)" stopOpacity="0.8" />
          <stop offset="35%" stopColor="var(--accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lg-warm">
          <stop offset="0%" stopColor="var(--star-white)" stopOpacity="0.7" />
          <stop offset="40%" stopColor="var(--warn)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--warn)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lg-streak" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--star-white)" stopOpacity="0.9" />
        </linearGradient>
      </defs>

      {/* distant galaxies, pinned: infinite distance, zero parallax */}
      <ellipse cx={W * 0.82} cy={H * 0.18} rx={70} ry={18}
        transform={`rotate(-24 ${W * 0.82} ${H * 0.18})`} fill="url(#lg-cool)" opacity={0.4} />
      <ellipse cx={W * 0.12} cy={H * 0.78} rx={52} ry={13}
        transform={`rotate(18 ${W * 0.12} ${H * 0.78})`} fill="url(#lg-warm)" opacity={0.35} />

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

      {streaks.map((s, i) => (
        <rect key={i} className="lnd-streak" x={s.x} y={s.y} width={s.len} height={1.4}
          rx={0.7} fill="url(#lg-streak)"
          style={{ animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }} />
      ))}
    </svg>
  );
}
