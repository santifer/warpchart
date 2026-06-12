"use client";

// Gentle UX nudge on portrait phones: the horizontal star chart is the full
// experience, so invite a rotation when the device's landscape side is wide
// enough to render it well. Disappears on rotate (orientation listener) and
// never shows on screens whose landscape would still be cramped.
import { useEffect, useState } from "react";

export default function RotateHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const landscapeSide = Math.max(window.screen.width, window.screen.height);
    const update = () => setShow(mq.matches && landscapeSide >= 640);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  if (!show) return null;
  return (
    <div className="hud mb-2 flex items-center justify-center gap-3 px-3 py-2">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden className="rotate-hint-icon">
        <rect x="7" y="3" width="10" height="18" rx="2" stroke="var(--accent)" strokeWidth="1.5" />
        <circle cx="12" cy="18" r="0.9" fill="var(--accent)" />
      </svg>
      <span className="numeral text-micro tracking-[0.18em] text-dim">
        ROTATE FOR THE FULL STAR CHART
      </span>
    </div>
  );
}
