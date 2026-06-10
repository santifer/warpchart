"use client";

// Returns the active chart palette, following the OS color scheme. Initial
// render is always dark (matching SSR output, so hydration never mismatches);
// light users flip on mount and on scheme changes.
import { useEffect, useState } from "react";
import { PALETTES, type Palette } from "./theme";

export function usePalette(): Palette {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    setLight(mq.matches);
    const fn = (e: MediaQueryListEvent) => setLight(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return light ? PALETTES.light : PALETTES.dark;
}
