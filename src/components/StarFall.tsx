"use client";

// Every star the repo gains in real time launches one prominent GOLDEN shooting
// star across the screen, on the same 45-degree line (lower-left to upper-right)
// as every other streak on the site. Gold is the living present: a new star
// just landed. Mirrors SoundController's arming so the backlog caught up on the
// first sync stays silent; only genuine live events shoot. Pointer-transparent,
// honors reduced motion (the CSS animation is disabled there).
import { useEffect, useRef, useState } from "react";
import { useLive } from "./LiveProvider";

interface Shot {
  id: number;
  top: number; // % of viewport
  left: number; // % of viewport
  len: number; // streak length, px
  dx: number; // travel distance up-right, px
  dur: number; // ms
}

const MAX_PER_TICK = 5; // a burst should feel alive, not flood the screen

export default function StarFall() {
  const live = useLive();
  const prevCount = useRef<number | null>(null);
  // The first sync replays the backlog accumulated since the bundle was built:
  // those are PAST stars, not live events, so they stay silent until armed.
  const armed = useRef(false);
  const idRef = useRef(0);
  const [shots, setShots] = useState<Shot[]>([]);

  useEffect(() => {
    const n = live.merged.length;
    const prev = prevCount.current;
    prevCount.current = n;
    if (prev === null) return;
    if (n > prev) {
      if (!armed.current) {
        armed.current = true; // backlog catch-up absorbed silently
        return;
      }
      const delta = Math.min(n - prev, MAX_PER_TICK);
      const fresh: Shot[] = Array.from({ length: delta }, () => ({
        id: idRef.current++,
        top: 22 + Math.random() * 50,
        left: -6 + Math.random() * 46,
        len: 240 + Math.random() * 200,
        dx: 760 + Math.random() * 420,
        dur: 1100 + Math.random() * 500,
      }));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShots((s) => [...s, ...fresh]);
      for (const shot of fresh) {
        setTimeout(() => setShots((s) => s.filter((x) => x.id !== shot.id)), shot.dur + 80);
      }
    } else if (live.lastSync !== null) {
      armed.current = true; // synced with nothing pending: live from here on
    }
  }, [live.merged.length, live.lastSync]);

  if (!shots.length) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" aria-hidden>
      {shots.map((s) => (
        <span
          key={s.id}
          className="starfall"
          style={
            {
              top: `${s.top}%`,
              left: `${s.left}%`,
              width: `${s.len}px`,
              "--dx": `${s.dx}px`,
              "--dur": `${s.dur}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
