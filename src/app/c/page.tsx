// The rising directory index: every category, ordered by heat (the total
// momentum the whole category is gaining right now). This is the literal
// "where software is moving" view, built from the cache-only catalog. Zero API
// cost, statically rendered, refreshed with each daily catalog.
import type { Metadata } from "next";
import Link from "next/link";
import Masthead from "@/components/Masthead";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import { listCategories } from "@/lib/catalog";
import { fmtCompact } from "@/lib/format";

export const revalidate = 21600; // 6h

export const metadata: Metadata = {
  title: "Where software is moving · rising GitHub repositories by category · Warpchart",
  description:
    "Browse the GitHub repositories climbing fastest right now, grouped by what they are for: AI, command line, databases, frontend, security and more. Ranked by momentum, not just total stars. Live, free, and updated daily.",
  alternates: { canonical: "/c" },
  openGraph: { images: ["/api/og"] },
};

export default function DirectoryIndex() {
  const { asOf, categories } = listCategories();
  const day = (asOf ?? "").slice(0, 10);
  const topics = categories.filter((c) => c.kind === "topic");
  const langs = categories.filter((c) => c.kind === "lang");

  const Card = ({ c }: { c: (typeof categories)[number] }) => (
    <Link
      prefetch={false}
      href={`/c/${c.id}`}
      className="hud flex flex-col gap-2 px-4 py-4 transition-colors hover:border-accent/40"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-display text-title tracking-[0.04em] text-ink">{c.label}</span>
        <span className="numeral text-micro tracking-[0.12em] text-accent">{fmtCompact(c.heat)} ★/day</span>
      </span>
      <span className="numeral text-micro tracking-[0.1em] text-faint">{c.count} systems charted</span>
      {c.top.length ? (
        <span className="line-clamp-1 text-label font-light text-dim">
          {c.top.map((t) => t.repo.split("/")[1] || t.repo).join("  ·  ")}
        </span>
      ) : null}
    </Link>
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-[1120px] flex-col gap-8 px-4 py-8 sm:px-6">
      <SpaceBackdrop mode="raceway" />
      <header className="rise" style={{ animationDelay: "0ms" }}>
        <Masthead demo={null} />
      </header>

      <section className="rise flex flex-col gap-2" style={{ animationDelay: "60ms" }}>
        <h1 className="font-display text-[clamp(1.6rem,4vw,2.6rem)] leading-tight tracking-[0.08em] text-star">
          WHERE SOFTWARE IS MOVING
        </h1>
        <p className="max-w-[760px] text-base font-light leading-relaxed text-dim">
          Every star is a human deciding something matters. We chart that decision across the whole of
          GitHub, every day, and sort it by where the momentum is going. Pick a domain to see what is
          climbing fastest right now, ranked by speed, not by the size it already reached.
        </p>
        <p className="numeral text-micro tracking-[0.15em] text-faint">
          {day ? `catalog of ${day} · ` : ""}heat = stars per day the whole category is gaining
        </p>
      </section>

      {!categories.length ? (
        <section className="rise hud px-4 py-6 text-center text-dim" style={{ animationDelay: "120ms" }}>
          <p className="text-label">The catalog is still warming up. Check back shortly.</p>
        </section>
      ) : (
        <>
          <section className="rise flex flex-col gap-3" style={{ animationDelay: "120ms" }}>
            <h2 className="font-display text-title tracking-[0.14em] text-ink">BY DOMAIN</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {topics.map((c) => (
                <Card key={c.id} c={c} />
              ))}
            </div>
          </section>

          {langs.length ? (
            <section className="rise flex flex-col gap-3" style={{ animationDelay: "180ms" }}>
              <h2 className="font-display text-title tracking-[0.14em] text-ink">BY LANGUAGE</h2>
              <div className="flex flex-wrap gap-2">
                {langs.map((c) => (
                  <Link
                    key={c.id}
                    prefetch={false}
                    href={`/c/${c.id}`}
                    className="hud numeral px-3 py-2 text-label text-dim transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    {c.label} · {fmtCompact(c.heat)} ★/day
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <footer className="rise flex flex-wrap items-center justify-between gap-2 pb-4 pt-2">
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          WARPCHART · open telemetry over public GitHub data
        </span>
        <Link prefetch={false} href="/velocity" className="numeral text-micro text-faint hover:text-dim">
          the warp index →
        </Link>
      </footer>
    </main>
  );
}
