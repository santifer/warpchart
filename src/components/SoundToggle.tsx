"use client";

import { useEffect, useRef, useState } from "react";
import { sound } from "@/lib/sound";

export default function SoundToggle() {
  const [on, setOn] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // If the user had sound enabled last time, re-enable it on the first
  // gesture anywhere EXCEPT this button (autoplay policy needs one gesture;
  // the button's own click handles itself, otherwise the global pointerdown
  // would turn sound on and the same gesture's click would toggle it back
  // off).
  useEffect(() => {
    if (!sound.restoreFromStorage()) return;
    const arm = (e: PointerEvent) => {
      if (btnRef.current && e.target instanceof Node && btnRef.current.contains(e.target)) return;
      window.removeEventListener("pointerdown", arm);
      sound.setEnabled(true);
      setOn(true);
    };
    window.addEventListener("pointerdown", arm);
    return () => window.removeEventListener("pointerdown", arm);
  }, []);

  const toggle = () => {
    // The engine is the single source of truth: immune to stale-closure races.
    const next = !sound.enabled;
    sound.setEnabled(next);
    setOn(next);
  };

  return (
    <button
      ref={btnRef}
      onClick={toggle}
      className="numeral flex items-center gap-1.5 text-micro tracking-[0.2em] text-dim transition-colors hover:text-ink min-h-[44px] items-center"
      aria-pressed={on}
      title="Toggle mission soundscape"
    >
      <span className={on ? "text-accent" : "text-faint"}>{on ? "◉" : "○"}</span>
      SOUND {on ? "ON" : "OFF"}
    </button>
  );
}
