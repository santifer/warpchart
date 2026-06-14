// Chart and SVG color palettes, one per scheme. Mirror of the CSS custom
// properties in globals.css: keep both in sync when tuning.
// All text colors meet WCAG AA contrast (>= 4.5:1) against hull/void.

export interface HeatStop {
  t: number;
  c: [number, number, number];
}

export interface Palette {
  void: string;
  hull: string;
  grid: string;
  ink: string;
  dim: string;
  faint: string;
  accent: string;
  accentSoft: string;
  warn: string;
  white: string; // highest-emphasis "star" color
  speck: string; // decorative dust particles
  scanBorder: string;
  scanBorderWarn: string;
  heat: HeatStop[];
  heatZero: string;
  // Doppler ramp for RELATIVE growth velocity (vs our own): blueshift means
  // we gain on them, redshift means they outrun us. Magnitude lives in the
  // comet-tail length, so only three hue states are needed per side.
  doppler: { cold: string; cool: string; neutral: string; warm: string; hot: string };
}

export const PALETTES: { dark: Palette; light: Palette } = {
  dark: {
    void: "#020509",
    hull: "#08111c",
    grid: "#11263b",
    ink: "#d9e8f5",
    dim: "#8aa3ba",
    faint: "#62809a",
    accent: "#53d6e8",
    accentSoft: "rgba(83, 214, 232, 0.14)",
    warn: "#f2a33c",
    white: "#f5fbff",
    speck: "#f5fbff",
    scanBorder: "rgba(83, 214, 232, 0.45)",
    scanBorderWarn: "rgba(242, 163, 60, 0.5)",
    heat: [
      { t: 0.0, c: [16, 38, 56] },
      { t: 0.35, c: [24, 132, 158] },
      { t: 0.62, c: [83, 214, 232] },
      { t: 0.85, c: [242, 163, 60] },
      { t: 1.0, c: [255, 233, 196] },
    ],
    heatZero: "rgba(83, 214, 232, 0.04)",
    doppler: {
      cold: "#8debff",
      cool: "#53d6e8",
      neutral: "#b9c9d9",
      warm: "#f2a33c",
      hot: "#ff7a55",
    },
  },
  light: {
    void: "#eef3f8",
    hull: "#f9fbfd",
    grid: "#c9d8e4",
    ink: "#16293c",
    dim: "#43607a",
    // synced with globals.css :root.scheme-light (WCAG AA on hull/void)
    faint: "#516678",
    accent: "#0a7286",
    accentSoft: "rgba(10, 114, 134, 0.10)",
    warn: "#a05a00",
    white: "#0a1726",
    speck: "#3a5268",
    scanBorder: "rgba(10, 114, 134, 0.5)",
    scanBorderWarn: "rgba(160, 90, 0, 0.55)",
    heat: [
      { t: 0.0, c: [223, 233, 241] },
      { t: 0.35, c: [156, 198, 212] },
      { t: 0.62, c: [28, 147, 170] },
      { t: 0.85, c: [176, 106, 0] },
      { t: 1.0, c: [92, 47, 0] },
    ],
    heatZero: "rgba(10, 114, 134, 0.05)",
    doppler: {
      cold: "#0894c4",
      cool: "#0a7286",
      neutral: "#516678",
      warm: "#a05a00",
      hot: "#b3422a",
    },
  },
};

// Dark constants for server-rendered artifacts that cannot react to the
// client scheme (OG image). Interactive components use usePalette() instead.
export const C = PALETTES.dark;
