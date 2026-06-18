// Sponsors wall and policy. The inventory is deliberately scarce and every
// placement is labeled; telemetry itself is never for sale.
import type { Metadata } from "next";
import Link from "next/link";
import { loadMeta } from "@/lib/history";

export const dynamic = "force-static";

export const metadata: Metadata = {
  alternates: { canonical: "/sponsors" },
  title: "Sponsors · Warpchart",
  description:
    "Support Warpchart, the open growth telemetry console for any GitHub repository. Scarce, clearly labeled sponsor placements. The data is never for sale.",
};

const TIERS = [
  {
    name: "PATRON",
    perk: "Your name in SPONSORS.md and on this wall.",
  },
  {
    name: "FEATURED",
    perk: "Logo on this page and a labeled FEATURED SCAN chip on the explore landing.",
  },
  {
    name: "LANDMARK",
    perk: "Top 1000 repos only: your repo's node on the route to the core carries its name and a sponsor glyph, at its REAL position. Max 4 slots.",
  },
];

export default function Sponsors() {
  const meta = loadMeta();
  return (
    <main className="mx-auto flex min-h-screen max-w-[860px] flex-col gap-10 px-4 py-10 sm:px-6">
      <header className="rise flex items-center justify-between" style={{ animationDelay: "0ms" }}>
        <Link href="/" className="font-display text-sm tracking-[0.3em] text-star hover:text-accent">
          WARPCHART
        </Link>
        <span className="numeral text-micro tracking-[0.2em] text-dim">MISSION PATRONS</span>
      </header>

      <section className="rise flex flex-col gap-4" style={{ animationDelay: "80ms" }}>
        <h1 className="font-display text-xl leading-snug tracking-[0.08em] text-ink sm:text-2xl">
          KEEP THE TELEMETRY FLOWING
        </h1>
        <p className="max-w-[620px] text-sm font-light text-dim">
          Warpchart is free, open source and runs on public GitHub data. Sponsorship covers
          hosting and keeps every chart, badge and scan free for everyone.
        </p>
        <div className="hud max-w-[620px] px-4 py-3">
          <p className="numeral text-data leading-relaxed text-ink">
            THE DATA IS NEVER FOR SALE. Sponsors buy clearly labeled placements, never
            position, size, velocity or ranking. If the map could be bought, it would be
            worthless to everyone, sponsors included.
          </p>
        </div>
      </section>

      <section className="rise flex flex-col gap-3" style={{ animationDelay: "160ms" }}>
        <h2 className="module-title">PLACEMENTS · scarce on purpose</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TIERS.map((t) => (
            <div key={t.name} className="hud px-4 py-3">
              <div className="numeral text-label tracking-[0.25em] text-accent">{t.name}</div>
              <p className="mt-2 text-data font-light leading-relaxed text-dim">{t.perk}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rise flex flex-col gap-3" style={{ animationDelay: "240ms" }}>
        <h2 className="module-title">THE WALL</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {meta ? (
            <div className="hud flex items-baseline justify-between gap-3 px-4 py-3">
              <span className="numeral text-data text-ink">{meta.repo}</span>
              <span className="numeral text-micro tracking-[0.2em] text-dim">HOUSE</span>
            </div>
          ) : null}
          <a
            href="https://github.com/sponsors/santifer"
            target="_blank"
            rel="noopener noreferrer"
            className="hud flex items-center justify-center gap-2 border-dashed px-4 py-3 transition-colors hover:border-accent/50"
          >
            <span className="numeral text-label tracking-[0.2em] text-accent">
              BECOME THE FIRST MISSION PATRON →
            </span>
          </a>
        </div>
      </section>

      <footer className="rise mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-grid pt-4" style={{ animationDelay: "320ms" }}>
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          WARPCHART · open telemetry over public GitHub data
        </span>
        <Link href="/" className="numeral text-micro text-accent/80 hover:text-accent">
          ← EXPLORE
        </Link>
      </footer>
    </main>
  );
}
