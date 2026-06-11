"use client";

// Cycles AUTO -> DARK -> LIGHT. Auto follows the OS scheme.
import { useThemeMode, type ThemeMode } from "@/lib/usePalette";

const NEXT: Record<ThemeMode, ThemeMode> = { auto: "dark", dark: "light", light: "auto" };
const GLYPH: Record<ThemeMode, string> = { auto: "◐", dark: "●", light: "○" };

export default function ThemeToggle() {
  const { mode, setMode } = useThemeMode();
  return (
    <button
      onClick={() => setMode(NEXT[mode])}
      className="numeral flex items-center gap-1.5 text-micro tracking-[0.2em] text-dim transition-colors hover:text-ink min-h-[44px] items-center"
      title="Theme: auto follows your OS scheme"
    >
      <span className={mode === "auto" ? "text-faint" : "text-accent"}>{GLYPH[mode]}</span>
      THEME {mode.toUpperCase()}
    </button>
  );
}
