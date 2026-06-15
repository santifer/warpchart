import Link from "next/link";
import Nav from "./Nav";

// The brand mark: a symmetric W climbing into a rounded arrow (inline so it
// inherits no requests; the full file lives at /logo.svg)
function LogoMark() {
  return (
    <svg viewBox="0 0 360 260" fill="none" className="h-[1.15em] w-auto" aria-hidden>
      <defs>
        <linearGradient id="mh-wgrad" gradientUnits="userSpaceOnUse" x1="45" y1="200" x2="330" y2="42">
          <stop offset="0" stopColor="#14506e" />
          <stop offset="0.55" stopColor="#2ba6c9" />
          <stop offset="1" stopColor="#4de1f7" />
        </linearGradient>
      </defs>
      <path
        d="M 45 100 L 92 195 L 139 100 L 186 195 L 282 91"
        stroke="url(#mh-wgrad)"
        strokeWidth="38"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 320 49 L 313 103 L 266 60 Z"
        fill="url(#mh-wgrad)"
        stroke="url(#mh-wgrad)"
        strokeWidth="20"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Shared top strip: the brand always routes home (the tweet-landing visitor
// must have an obvious way to scan their own repo), controls on the right.
export default function Masthead({ demo }: { demo?: string | null }) {
  return (
    <div className="flex flex-col gap-2">
      {/* row 1: brand on the left, all menus right-aligned */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          prefetch={false}
          href="/"
          className="font-display flex items-center gap-2.5 text-sm tracking-[0.3em] text-star transition-colors hover:text-accent"
        >
          <LogoMark />
          WARPCHART
        </Link>
        <Nav demo={demo} />
      </div>
      {/* row 2 (desktop): the live demo mission on its own line, right-aligned,
          so the top strip stays one tidy menu row instead of cramming */}
      {demo ? (
        <div className="hidden justify-end md:flex">
          <Link
            prefetch={false}
            href={`/r/${demo}`}
            className="numeral border border-grid px-3 py-1.5 text-micro tracking-[0.18em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
          >
            LIVE DEMO MISSION: {demo} →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
