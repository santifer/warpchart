// The public root IS the landing: search any repository, ask for the best repo
// for a need, jump into a system, grab the embeddable chart. Served natively at
// / (no redirect, no rewrite). The house repo's live console lives at /console,
// every other repo's at /r/owner/name. Fully static-friendly; the top-1000
// catalog ships with the page so autocomplete costs zero API calls.
import { ViewTransition } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import ExploreSearch, { type CatalogEntry } from "@/components/ExploreSearch";
import EmbedGenerator from "@/components/EmbedGenerator";
import GalaxyHero from "@/components/GalaxyHero";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import Masthead from "@/components/Masthead";
import CapabilitiesBand from "@/components/CapabilitiesBand";
import SpotlightChart from "@/components/SpotlightChart";
import VerticalChart from "@/components/VerticalChart";
import { buildDemoSpotlight } from "@/lib/demo";
import { buildGalaxy } from "@/lib/galaxy";
import { canonicalVelocity } from "@/lib/velocity";
import { loadRoute, loadMeta } from "@/lib/history";
import { listCodexes } from "@/lib/codex";
import { fmtCompact } from "@/lib/format";

// ISR (not force-static) so the discovery feed and spotlight stay fresh: the
// charted frontier moves as explorers open new systems.
export const revalidate = 600;

export const metadata: Metadata = {
  title: "Warpchart · the present tense of open source",
  description:
    "Chart any GitHub repository's worldwide rank and momentum, ask for the best repo for any need, and browse what is rising by category. Live and free, with the one growth history nobody else keeps.",
  alternates: { canonical: "/" },
};

export default async function Home() {
  const route = loadRoute();
  const meta = loadMeta();
  const spotlight = await buildDemoSpotlight().catch(() => null);
  const catalog: CatalogEntry[] = (route?.repos ?? []).map((p, i) => ({
    r: p.r,
    s: p.s,
    k: i + 1,
  }));
  const featured = [0, 7, 24, 79, 199, 499]
    .filter((i) => i < catalog.length)
    .map((i) => catalog[i]);

  // hero galaxy: the whole top 1000 projected onto the isometric star map;
  // the house mission rides along with its own quiet signature, and half
  // of the featured labels rotate with the build day (like the spotlight)
  const galaxy = route?.repos?.length
    ? buildGalaxy(
        route.repos.map((p) => ({ r: p.r, s: p.s, v: p.v ?? null, v7: p.v7 ?? null })),
        meta?.repo ?? null,
        new Date().toISOString().slice(0, 10),
      )
    : null;

  // landing teaser for the velocity rankings: today's three fastest movers, on
  // the CANONICAL 7-day rate (v7, ~1-day v fallback) so the first velocity a
  // visitor sees matches /velocity and the /r/ page they click into.
  const fastest = (route?.repos ?? [])
    .map((p, i) => ({ r: p.r, v: canonicalVelocity(p), rank: i + 1 }))
    .filter((p): p is { r: string; v: number; rank: number } => p.v !== null && p.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 3);

  // discovery feed: the systems explorers charted most recently (a codex was
  // distilled on first visit). Empty until the first charts land.
  const recentCharted = (await listCodexes().catch(() => [])).slice(0, 6);

  return (
    // the warp jump: leaving through the galaxy plays warp-out (blur flash);
    // any other navigation changes pages normally
    <ViewTransition exit={{ warp: "gx-warp-out", default: "none" }} default="none">
    <main className="mx-auto flex min-h-screen max-w-[1120px] flex-col gap-14 px-4 py-12 sm:px-6">
      <SpaceBackdrop mode="scan" />
      <header className="rise" style={{ animationDelay: "0ms" }}>
        <Masthead demo={meta?.repo ?? null} />
      </header>

      {/* hero: the real top 1000 as a partially isometric galaxy, core in
          the top-right corner, headline column on the left */}
      {/* no overflow-hidden here: the galaxy stage does its own clipping
          with a raised roof, so starlight can glow past the hero's top
          edge instead of cutting on an invisible line under the header */}
      {/* z-20: the hero and the spotlight below are both persistent stacking
          contexts (-translate-x-1/2), so by DOM order the later spotlight would
          paint OVER the ASK dropdown that overflows down into it. Lift the hero
          so its dropdown (z-30 within) stays on top; still under the nav (z-50). */}
      <section
        className="gx-hero-sec rise relative z-20 left-1/2 w-screen -translate-x-1/2"
        style={{ animationDelay: "80ms" }}
      >
        <div className="relative h-[560px] sm:h-[640px]">
          {galaxy ? <GalaxyHero data={galaxy} /> : null}
          <div className="gx-hero-copy pointer-events-none relative z-10 mx-auto flex h-full max-w-[1840px] flex-col items-center justify-center px-4 sm:px-10 lg:items-start 2xl:px-16">
            {/* one solid block: it owns the pointer over the whole copy
                column, so the galaxy's hover zoom only lives on the map */}
            <div className="pointer-events-auto flex w-fit flex-col items-center gap-7 text-center lg:items-start lg:text-left">
              <h1 className="glow-star font-display max-w-[900px] text-[clamp(1.9rem,3.5vw,3rem)] leading-[1.14] tracking-[0.05em] text-star">
                OPEN SOURCE IS A RACE.
                <br /> CHART ANY REPO&apos;S CLIMB.
              </h1>
              <p className="max-w-[620px] text-lg font-light leading-relaxed text-dim">
                See any GitHub repository&apos;s worldwide rank, how fast it is climbing, and the
                repos closing in on it. Live and free, with the one history nobody else keeps.
                Pick a system, <span className="text-accent">or ask for any tech.</span>
              </p>
              {/* a DEFINITE width (not max-w inside the w-fit hero column):
                  ASK results have long text, and fit-content would size to
                  their max-content and overflow the phone. Cap to the viewport. */}
              <div className="w-[min(640px,88vw)]">
                <ExploreSearch catalog={catalog} />
              </div>
              <p className="numeral text-label tracking-[0.18em] text-faint">
                free · no signup · open source (mit) · self-host in 5 min
              </p>
            </div>
          </div>
        </div>
      </section>

      {spotlight ? (
        // full-bleed: the showpiece breaks out of the text column and uses
        // the whole viewport; the SVG scales up and gets MORE legible
        <section
          className="rise relative left-1/2 w-screen -translate-x-1/2"
          style={{ animationDelay: "120ms" }}
        >
          <div className="mx-auto mb-3 flex max-w-[1840px] flex-wrap items-baseline justify-between gap-2 px-4 sm:px-10 2xl:px-16">
            <h2 className="font-display text-title tracking-[0.14em] text-ink">
              TODAY&apos;S SPOTLIGHT <span className="text-accent">· {spotlight.inputs.repo}</span>{" "}
              <span className="text-dim">· #{spotlight.rank} worldwide</span>
            </h2>
            <span className="numeral text-micro text-faint">
              random pick from the top 1000 · rotates daily · pan it, hover the systems
            </span>
          </div>
          {/* the space itself runs edge to edge (the page backdrop's stars
              shine through the tinted band); only the text stays in column */}
          <div className="border-y border-grid bg-hull/30 py-2 sm:py-3">
            <div className="mx-auto max-w-[2200px] px-2 sm:px-6">
              <div className="hidden landscape:block lg:block">
                <SpotlightChart inputs={spotlight.inputs} />
              </div>
              <div className="landscape:hidden lg:hidden">
                <VerticalChart inputs={spotlight.inputs} />
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-center">
            <Link
              prefetch={false}
              href={`/r/${spotlight.inputs.repo}`}
              className="numeral border border-accent/50 bg-accent/10 px-5 py-2.5 text-label tracking-[0.2em] text-accent transition-colors hover:bg-accent/20"
            >
              OPEN THIS SYSTEM →
            </Link>
          </div>
        </section>
      ) : null}

      <section className="rise" style={{ animationDelay: "130ms" }}>
        <CapabilitiesBand />
      </section>

      {fastest.length ? (
        <section
          className="rise flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2"
          style={{ animationDelay: "140ms" }}
        >
          <span className="numeral text-label tracking-[0.18em] text-dim">
            FASTEST SYSTEMS TODAY ·{" "}
            {fastest.map((f, i) => (
              <span key={f.r}>
                {i > 0 ? " · " : ""}
                <Link prefetch={false} href={`/r/${f.r}`} className="text-ink hover:text-accent">
                  {f.r.split("/")[1]}
                </Link>{" "}
                <span className="text-accent">{Math.round(f.v)}/day</span>
              </span>
            ))}
          </span>
          <Link
            prefetch={false}
            href="/velocity"
            className="numeral text-label tracking-[0.18em] text-accent hover:underline underline-offset-4"
          >
            FULL VELOCITY RANKINGS →
          </Link>
        </section>
      ) : null}

      {recentCharted.length ? (
        <section
          className="rise flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2"
          style={{ animationDelay: "150ms" }}
        >
          <span className="numeral text-label tracking-[0.18em] text-dim">
            <span className="cdx-pulse mr-2 inline-block h-[6px] w-[6px] rounded-full bg-accent/70 align-middle" aria-hidden />
            RECENTLY CHARTED ·{" "}
            {recentCharted.map((e, i) => (
              <span key={e.repo}>
                {i > 0 ? " · " : ""}
                <Link prefetch={false} href={`/r/${e.repo}`} className="text-ink hover:text-accent">
                  {e.repo.split("/")[1]}
                </Link>
              </span>
            ))}
          </span>
          <Link
            prefetch={false}
            href="/codex"
            className="numeral text-label tracking-[0.18em] text-accent hover:underline underline-offset-4"
          >
            BROWSE THE CODEX →
          </Link>
        </section>
      ) : null}

      <section className="rise flex flex-col gap-3" style={{ animationDelay: "160ms" }}>
        <h2 className="font-display text-title tracking-[0.14em] text-ink">FEATURED SCANS</h2>
        {/* phones: one full-width row per card so long names ("system-design-
            primer") survive whole; two narrow columns truncated them to 4 chars */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {featured.map((f) => (
            <Link
              key={f.r}
              prefetch={false}
              href={`/r/${f.r}`}
              className="hud group flex items-baseline justify-between gap-2 px-4 py-3.5 transition-colors hover:border-accent/40"
            >
              <span className="numeral min-w-0 truncate text-base text-ink group-hover:text-accent">
                {f.r.split("/")[1]}
              </span>
              <span className="numeral shrink-0 text-micro text-dim">
                #{f.k} · {fmtCompact(f.s)} ★
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="rise flex flex-col gap-3" style={{ animationDelay: "240ms" }}>
        <h2 className="font-display text-title tracking-[0.14em] text-ink">EMBED THE ANIMATED CHART <span className="text-dim">· any repo, any readme</span></h2>
        <p className="max-w-[680px] text-base font-light leading-relaxed text-dim">
          The chart draws itself on every view: pure SVG animation, no JavaScript, works
          through GitHub&apos;s image proxy and follows the reader&apos;s color scheme.
        </p>
        <EmbedGenerator defaultRepo={meta?.repo ?? "facebook/react"} catalog={catalog} />
      </section>

      <footer className="rise mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-grid pt-4" style={{ animationDelay: "320ms" }}>
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          WARPCHART · by the maker of{" "}
          <a href="https://career-ops.org" className="text-accent/80 transition-colors hover:text-accent">
            career-ops
          </a>
        </span>
        <nav className="numeral flex flex-wrap items-center gap-x-3 gap-y-1 text-micro tracking-[0.14em] text-faint">
          <Link href="/codex" className="hover:text-accent">CODEX</Link>
          <Link href="/velocity" className="hover:text-accent">WARP INDEX</Link>
          <Link href="/constellation" className="hover:text-accent">CONSTELLATION</Link>
          <Link href="/methodology" className="hover:text-accent">METHODOLOGY</Link>
          <Link href="/docs" className="hover:text-accent">DOCS</Link>
          <Link href="/pricing" className="hover:text-accent">PRICING</Link>
          <Link href="/sponsors" className="text-accent/80 hover:text-accent">PATRONS</Link>
        </nav>
        <span className="numeral text-micro text-faint">
          worldwide registry refreshed daily · live polling every 60s
        </span>
      </footer>
    </main>
    </ViewTransition>
  );
}
