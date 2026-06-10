"use client";

import { useEffect, useState } from "react";
import { sound } from "@/lib/sound";

export default function SoundToggle() {
  const [on, setOn] = useState(false);

  // If the user had sound enabled last time, re-enable it on the first
  // gesture anywhere (autoplay policy requires one).
  useEffect(() => {
    if (!sound.restoreFromStorage()) return;
    const arm = () => {
      sound.setEnabled(true);
      setOn(true);
    };
    window.addEventListener("pointerdown", arm, { once: true });
    return () => window.removeEventListener("pointerdown", arm);
  }, []);

  const toggle = () => {
    const next = !on;
    sound.setEnabled(next);
    setOn(next);
  };

  return (
    <button
      onClick={toggle}
      className="numeral flex items-center gap-1.5 text-[9px] tracking-[0.2em] text-dim transition-colors hover:text-ink"
      aria-pressed={on}
      title="Toggle mission soundscape"
    >
      <span className={on ? "text-accent" : "text-faint"}>{on ? "◉" : "○"}</span>
      SOUND {on ? "ON" : "OFF"}
    </button>
  );
}
