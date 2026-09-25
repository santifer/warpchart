"use client";

// MOTION GOVERNOR: ambient motion settles when nobody is looking. After IDLE_MS
// without a pointer, key, wheel, touch or scroll event, at once when the window
// loses focus (the tab left visible beside another app), and whenever the tab
// is hidden, it stamps data-motion="idle" on <html>; globals.css then pauses
// every CSS animation on the page. The first interaction wakes it again.
//
// Why: a quiet /r/ page kept ~400 CSS animations running (twinkling dust,
// streaks, drifting lanes) and held a Chrome renderer at 50-70% CPU with the
// fans on, for decoration nobody was watching (measured 25-sep-2026). Motion
// is the welcome, not the wallpaper: it plays while someone interacts and
// freezes in place, mid-frame, once they stop. Measured on the same page: a
// renderer at 48-72% before, 0% once idle. While awake it still costs ~40%:
// most of the motion animates SVG children, which the compositor cannot take
// over, so ANY running animation repaints large areas every frame (disabling
// the dust, the chart or every backdrop-filter alone changed almost nothing;
// only stopping all of them did). Hence a governor, not a per-effect fix.
import { useEffect } from "react";

const IDLE_MS = 15_000;

export default function MotionGovernor() {
  useEffect(() => {
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // write the attribute only on a real change: pointermove fires constantly,
    // and re-setting the same value would still invalidate style on <html>
    const set = (v: "on" | "idle") => {
      if (root.dataset.motion !== v) root.dataset.motion = v;
    };
    const wake = () => {
      set("on");
      clearTimeout(timer);
      timer = setTimeout(() => set("idle"), IDLE_MS);
    };
    const sleep = () => {
      clearTimeout(timer);
      set("idle");
    };
    const onVisibility = () => (document.hidden ? sleep() : wake());
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const e of events) window.addEventListener(e, wake, opts);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", sleep);
    window.addEventListener("focus", wake);
    if (document.hasFocus()) wake();
    else sleep();
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake, opts);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", sleep);
      window.removeEventListener("focus", wake);
      delete root.dataset.motion;
    };
  }, []);
  return null;
}
