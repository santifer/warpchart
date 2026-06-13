import { useEffect, useRef } from "react";

// Horizontal pan over a chart via wheel + touch. onPan(frac) gets the gesture
// distance as a fraction of the chart's width (positive = swipe LEFT / wheel
// forward = reveal OLDER data). onPan returns true when it consumed the
// gesture (the window actually moved); only then is the native scroll
// prevented, so a chart with nothing left to pan never hijacks page scroll.
export function useChartPan(onPan: (frac: number) => boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onPan);
  cb.current = onPan;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastX: number | null = null;
    let lastY: number | null = null;

    const wheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (d === 0) return;
      if (cb.current(d / (el.clientWidth || 1))) e.preventDefault();
    };
    const ts = (e: TouchEvent) => {
      lastX = e.touches[0]?.clientX ?? null;
      lastY = e.touches[0]?.clientY ?? null;
    };
    const tm = (e: TouchEvent) => {
      if (lastX === null || lastY === null) return;
      const x = e.touches[0]?.clientX ?? lastX;
      const y = e.touches[0]?.clientY ?? lastY;
      const dx = lastX - x, dy = lastY - y;
      lastX = x;
      lastY = y;
      // vertical-dominant gesture → let the page scroll
      if (Math.abs(dy) > Math.abs(dx)) return;
      const frac = dx / (el.clientWidth || 1);
      if (frac !== 0 && cb.current(frac)) e.preventDefault();
    };
    const te = () => {
      lastX = null;
    };

    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", te);
    };
  }, []);

  return ref;
}
