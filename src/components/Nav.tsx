"use client";

// Masthead navigation. On md+ the links and toggles sit inline; below md they
// collapse behind a hamburger so the dense nav (3 links + sound + theme + demo)
// stops wrapping into two cramped rows on phones. The dropdown closes on
// Escape, on an outside click, and on navigation. Tap targets are >=44px and
// colors use the AA-audited tokens.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SoundToggle from "./SoundToggle";
import ThemeToggle from "./ThemeToggle";

// ASK lives on the home now (the SCAN/ASK toggle on the hero search), so it is
// no longer a separate nav destination.
const LINKS = [
  { href: "/compare", label: "COMPARE" },
  { href: "/c", label: "RISING" },
  { href: "/velocity", label: "WARP INDEX" },
  { href: "/docs", label: "DOCS" },
  { href: "/pricing", label: "PRICING" },
];

export default function Nav({ demo }: { demo?: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onClick);
    };
  }, [open]);

  return (
    <>
      {/* desktop / tablet: inline */}
      <div className="hidden flex-wrap items-center gap-x-4 md:flex">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            prefetch={false}
            href={l.href}
            className="numeral py-2 -my-2 text-micro tracking-[0.2em] text-dim transition-colors hover:text-accent"
          >
            {l.label}
          </Link>
        ))}
        <SoundToggle />
        <ThemeToggle />
        {/* LIVE DEMO MISSION moved to its own right-aligned second row in the
            Masthead so the desktop menu stays a single tidy line */}
      </div>

      {/* mobile: hamburger */}
      <div ref={ref} className="relative md:hidden">
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((o) => !o)}
          className="flex h-11 w-11 -mr-2 items-center justify-center text-dim transition-colors hover:text-accent"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
            {open ? (
              <>
                <line x1="4" y1="4" x2="18" y2="18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <line x1="18" y1="4" x2="4" y2="18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="19" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <line x1="3" y1="11" x2="19" y2="11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <line x1="3" y1="16" x2="19" y2="16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </>
            )}
          </svg>
        </button>

        {open ? (
          <div
            id="mobile-nav"
            className="hud absolute right-0 top-full z-50 mt-2 flex w-[200px] flex-col bg-void/95 p-1.5 backdrop-blur"
          >
            {LINKS.map((l) => (
              <Link
                key={l.href}
                prefetch={false}
                href={l.href}
                onClick={() => setOpen(false)}
                className="numeral flex min-h-[44px] items-center px-3 text-label tracking-[0.2em] text-dim transition-colors hover:bg-accent/10 hover:text-accent"
              >
                {l.label}
              </Link>
            ))}
            {demo ? (
              <Link
                prefetch={false}
                href={`/r/${demo}`}
                onClick={() => setOpen(false)}
                className="numeral flex min-h-[44px] items-center px-3 text-label tracking-[0.18em] text-accent transition-colors hover:bg-accent/10"
              >
                LIVE DEMO: {demo.split("/")[1]} →
              </Link>
            ) : null}
            <div className="mt-1 flex items-center gap-3 border-t border-grid px-3 pt-2">
              <SoundToggle />
              <ThemeToggle />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
