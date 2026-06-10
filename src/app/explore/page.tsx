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
    <main className="mx-auto flex min-h-screen max-w-[980px] flex-col gap-10 px-4 py-10 sm:px-6">
      <ExploreBackdrop />
      <header className="rise flex items-center justify-between" style={{ animationDelay: "0ms" }}>
        <span className="font-display text-xs tracking-[0.3em] text-star">WARPCHART</span>
        {meta ? (
          <Link
            prefetch={false}
            href="/hq"
            className="numeral border border-grid px-3 py-1.5 text-[9px] tracking-[0.18em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
          >
            LIVE DEMO MISSION: {meta.repo} →
          </Link>
        ) : null}
      </header>

      <section className="rise flex flex-col items-center gap-6 pt-6 text-center" style={{ animationDelay: "80ms" }}>
        <h1 className="font-display max-w-[700px] text-2xl leading-snug tracking-[0.08em] text-ink sm:text-3xl">
          GROWTH TELEMETRY FOR ANY GITHUB REPOSITORY
        </h1>
        <p className="max-w-[560px] text-sm font-light text-dim">
          Live star chart, worldwide rank, ranking neighbors with relative velocity, and the
          route to the number one repository on Earth. Pick a ship.
        </p>
        <div className="w-full max-w-[640px]">
          <ExploreSearch catalog={catalog} />
        </div>
      </section>

      {spotlight ? (
        <section className="rise flex flex-col gap-3" style={{ animationDelay: "120ms" }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="module-title">
              TODAY&apos;S SPOTLIGHT · {spotlight.inputs.repo} · #{spotlight.rank} worldwide
            </h2>
            <span className="numeral text-[9px] text-faint">
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
        <h2 className="module-title">FEATURED SCANS</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {featured.map((f) => (
            <Link
              key={f.r}
              prefetch={false}
              href={`/r/${f.r}`}
              className="hud group flex items-baseline justify-between gap-2 px-3 py-2.5 transition-colors hover:border-accent/40"
            >
              <span className="numeral min-w-0 truncate text-[11px] text-ink group-hover:text-accent">
                {f.r.split("/")[1]}
              </span>
              <span className="numeral shrink-0 text-[9px] text-dim">
                #{f.k} · {fmtCompact(f.s)} ★
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="rise flex flex-col gap-3" style={{ animationDelay: "240ms" }}>
        <h2 className="module-title">EMBED THE ANIMATED CHART · any repo, any README</h2>
        <p className="max-w-[640px] text-xs font-light text-dim">
          The chart draws itself on every view: pure SVG animation, no JavaScript, works
          through GitHub&apos;s image proxy and follows the reader&apos;s color scheme.
        </p>
        <EmbedGenerator defaultRepo={meta?.repo ?? "facebook/react"} />
      </section>

      <footer className="rise mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-grid pt-4" style={{ animationDelay: "320ms" }}>
        <span className="numeral text-[9px] tracking-[0.15em] text-faint">
          WARPCHART · open telemetry over public GitHub data
        </span>
        <Link href="/sponsors" className="numeral text-[9px] tracking-[0.15em] text-accent/80 transition-colors hover:text-accent">
          MISSION PATRONS →
        </Link>
        <span className="numeral text-[9px] text-faint">
          worldwide registry refreshed daily · live polling every 60s
        </span>
      </footer>
    </main>
  );
}
