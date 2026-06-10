"use client";

// Theme plumbing: auto (OS) by default, with a manual light/dark override
// persisted in localStorage. The resolved scheme is applied as a class on
// <html> (an inline script in the layout does the same before first paint,
// so there is no flash). Charts read their palette from here.
import {
  createContext, useContext, useEffect, useMemo, useState,
} from "react";
import { PALETTES, type Palette } from "./theme";

export type ThemeMode = "auto" | "light" | "dark";
type Resolved = "light" | "dark";

const STORAGE_KEY = "mc_theme";

interface ThemeCtxValue {
  mode: ThemeMode;
  resolved: Resolved;
  setMode: (m: ThemeMode) => void;
}

const ThemeCtx = createContext<ThemeCtxValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("auto");
  const [sysLight, setSysLight] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") setModeState(stored);
    } catch { /* private mode */ }
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    setSysLight(mq.matches);
    const fn = (e: MediaQueryListEvent) => setSysLight(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  const resolved: Resolved = mode === "auto" ? (sysLight ? "light" : "dark") : mode;

  useEffect(() => {
    document.documentElement.classList.toggle("scheme-light", resolved === "light");
  }, [resolved]);

  const value = useMemo<ThemeCtxValue>(
    () => ({
      mode,
      resolved,
      setMode: (m: ThemeMode) => {
        setModeState(m);
        try {
          if (m === "auto") localStorage.removeItem(STORAGE_KEY);
          else localStorage.setItem(STORAGE_KEY, m);
        } catch { /* private mode */ }
      },
    }),
    [mode, resolved]
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useThemeMode(): ThemeCtxValue {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useThemeMode outside ThemeProvider");
  return ctx;
}

export function usePalette(): Palette {
  const ctx = useContext(ThemeCtx);
  return ctx?.resolved === "light" ? PALETTES.light : PALETTES.dark;
}
