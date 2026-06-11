// Public landing: search any repository, jump into its system, grab the
// embeddable animated chart. Fully static; the top-1000 catalog ships with
// the page so autocomplete costs zero API calls.
import type { Metadata } from "next";
import Link from "next/link";
import ExploreSearch, { type CatalogEntry } from "@/components/ExploreSearch";
import EmbedGenerator from "@/components/EmbedGenerator";
import ExploreBackdrop from "@/components/ExploreBackdrop";
import GalacticChart from "@/components/GalacticChart";
import VerticalChart from "@/components/VerticalChart";
import { buildDemoSpotlight } from "@/lib/demo";
import { loadRoute, loadMeta } from "@/lib/history";
import { fmtCompact } from "@/lib/format";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Explore any GitHub repository · Warpchart",
  description:
    "Growth telemetry for any GitHub repository: live star chart, worldwide rank, ranking neighbors and an embeddable animated star history chart for your README.",
};

export default async function Explore() {
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

  return (
    <main className="mx-auto flex min-h-screen max-w-[1020px] flex-col gap-14 px-4 py-12 sm:px-6">
      <ExploreBackdrop />
      <header className="rise flex items-center justify-between" style={{ animationDelay: "0ms" }}>
        <span className="font-display text-sm tracking-[0.3em] text-star">WARPCHART</span>
        {meta ? (
          <Link
            prefetch={false}
            href={`/r/${meta.repo}`}
            className="numeral border border-grid px-3 py-1.5 text-micro tracking-[0.18em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
          >
            LIVE DEMO MISSION: {meta.repo} →
          </Link>
        ) : null}
      </header>

      <section className="rise relative flex flex-col items-center gap-7 pb-4 pt-12 text-center sm:pt-16" style={{ animationDelay: "80ms" }}>
        {/* soft nebula behind the hero */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[480px] w-[900px] -translate-x-1/2 opacity-60"
          style={{ background: "radial-gradient(ellipse 50% 45% at 50% 38%, var(--accent-soft), transparent 70%)" }}
        />
        <h1 className="glow-star font-display max-w-[980px] text-[clamp(2.3rem,4.8vw,3.8rem)] leading-[1.12] tracking-[0.05em] text-star">
          GROWTH TELEMETRY
          <br className="hidden sm:block" /> FOR ANY GITHUB REPO
        </h1>
        <p className="max-w-[660px] text-lg font-light leading-relaxed text-dim">
          Live star chart, worldwide rank, neighbors with relative velocity, and the route to
          the number one repository on Earth. Pick a ship.
        </p>
        <div className="w-full max-w-[720px]">
          <ExploreSearch catalog={catalog} />
        </div>
        <p className="numeral text-label tracking-[0.18em] text-faint">
          free · no signup · open source (mit) · self-host in 5 minutes
        </p>
      </section>

      {spotlight ? (
        <section className="rise flex flex-col gap-3" style={{ animationDelay: "120ms" }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-title tracking-[0.14em] text-ink">
              TODAY&apos;S SPOTLIGHT <span className="text-accent">· {spotlight.inputs.repo}</span>{" "}
              <span className="text-dim">· #{spotlight.rank} worldwide</span>
            </h2>
            <span className="numeral text-micro text-faint">
              a real top 1000 system, rotating daily · pan it, hover the ships
            </span>
          </div>
          <div className="hud p-2">
            <div className="hidden lg:block">
              <GalacticChart inputs={spotlight.inputs} />
            </div>
            <div className="lg:hidden">
              <VerticalChart inputs={spotlight.inputs} />
            </div>
          </div>
        </section>
      ) : null}

      <section className="rise flex flex-col gap-3" style={{ animationDelay: "160ms" }}>
        <h2 className="font-display text-title tracking-[0.14em] text-ink">FEATURED SCANS</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
        <EmbedGenerator defaultRepo={meta?.repo ?? "facebook/react"} />
      </section>

      <footer className="rise mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-grid pt-4" style={{ animationDelay: "320ms" }}>
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          WARPCHART · open telemetry over public GitHub data
        </span>
        <Link href="/sponsors" className="numeral text-micro tracking-[0.15em] text-accent/80 transition-colors hover:text-accent">
          MISSION PATRONS →
        </Link>
        <span className="numeral text-micro text-faint">
          worldwide registry refreshed daily · live polling every 60s
        </span>
      </footer>
    </main>
  );
}
