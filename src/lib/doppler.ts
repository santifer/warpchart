// Continuous Doppler tilt shared by both star charts: hue shifts smoothly
// with the velocity DIFFERENCE (rel = their velocity / ours), so one glance
// carries both the sign and the size of the duel. Formation (±15%) stays
// neutral; the slower side deepens neutral->cool->cold (we shift blue: we
// are the ones closing on it), the faster side neutral->warm->hot.
import type { Palette } from "@/lib/theme";

function hexToRgb(h: string): [number, number, number] {
  const v = h.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((x, i) => Math.round(x + (B[i] - x) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function dopplerTilt(rel: number, P: Palette): string {
  const mag = Math.abs(1 - rel);
  if (mag <= 0.15) return P.doppler.neutral;
  if (rel < 1) {
    // slower than us: mag tops out at 1 (a fully stalled repo)
    const t = Math.min((mag - 0.15) / 0.85, 1);
    return t < 0.5
      ? mix(P.doppler.neutral, P.doppler.cool, t * 2)
      : mix(P.doppler.cool, P.doppler.cold, (t - 0.5) * 2);
  }
  // faster than us: saturate at 3x our velocity
  const t = Math.min((mag - 0.15) / 1.85, 1);
  return t < 0.5
    ? mix(P.doppler.neutral, P.doppler.warm, t * 2)
    : mix(P.doppler.warm, P.doppler.hot, (t - 0.5) * 2);
}
