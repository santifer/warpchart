// The visual sigil for a repo classification: a circular "mission patch" — a thin
// ring + a celestial form + a signature color and soft halo. Pure inline SVG, so
// it renders identically as a tiny node in the star field (sm) and as a large
// emblem in a dossier (lg), in server components, and inside Satori (OG cards).
import type { ReactNode } from "react";

type Key = "comet" | "meteor" | "blue-giant" | "main-sequence" | "foundational";

const COLOR: Record<Key, string> = {
  comet: "#5ef2cf", // teal — live momentum, surging right now
  meteor: "#f2a33c", // amber — fast, hot, young
  "blue-giant": "#53d6e8", // cyan — the brightest
  "main-sequence": "#bfe9ff", // star-white
  foundational: "#a78bfa", // violet — set apart from the growth classes
};

// The signature color of a badge key, for non-SVG surfaces (e.g. the OG card,
// where Satori can't safely render the full sigil).
export function badgeColor(key: string): string {
  return COLOR[key as Key] ?? "#bfe9ff";
}

// each form is drawn in a 32x32 box, centered on (16,16), in `currentColor`
const ART: Record<Key, ReactNode> = {
  // bright head low-left, tail sweeping UP-right: a comet on the rise
  comet: (
    <>
      <path d="M13.5 18.5 L24 8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M13 16 L19 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
      <path d="M16.5 21.5 L22.5 16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
      <circle cx="11" cy="21" r="3.1" fill="currentColor" />
      <circle cx="11" cy="21" r="1.3" fill="#fff" opacity="0.9" />
    </>
  ),
  meteor: (
    <>
      <circle cx="20.5" cy="11.5" r="3" fill="currentColor" />
      <path d="M18.5 13.5 L9 23" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16.5 12 L10.5 18" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
      <path d="M22 16 L17 21" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
    </>
  ),
  "blue-giant": (
    <>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const r = (a * Math.PI) / 180;
        return (
          <line
            key={a}
            x1={16 + Math.cos(r) * 7}
            y1={16 + Math.sin(r) * 7}
            x2={16 + Math.cos(r) * 10.5}
            y2={16 + Math.sin(r) * 10.5}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        );
      })}
      <circle cx="16" cy="16" r="5.5" fill="currentColor" />
      <circle cx="16" cy="16" r="2.4" fill="#fff" opacity="0.9" />
    </>
  ),
  "main-sequence": (
    <>
      <path
        d="M16 6 L17.6 14.4 L26 16 L17.6 17.6 L16 26 L14.4 17.6 L6 16 L14.4 14.4 Z"
        fill="currentColor"
      />
    </>
  ),
  foundational: (
    <>
      <path
        d="M16 6.5 L24.2 11.25 L24.2 20.75 L16 25.5 L7.8 20.75 L7.8 11.25 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.6" fill="currentColor" />
    </>
  ),
};

export default function BadgeSigil({ badgeKey, size = 20 }: { badgeKey: string; size?: number }) {
  const k = badgeKey as Key;
  if (!ART[k]) return null;
  const c = COLOR[k];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ color: c, flexShrink: 0 }} aria-hidden>
      <defs>
        <radialGradient id={`halo-${k}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={c} stopOpacity="0.28" />
          <stop offset="70%" stopColor={c} stopOpacity="0.06" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#halo-${k})`} />
      <circle cx="16" cy="16" r="13.5" fill="none" stroke={c} strokeOpacity="0.55" strokeWidth="1.2" />
      {ART[k]}
    </svg>
  );
}
