// THE CODEX index: every system an explorer has charted. Each first visit to a
// repo distils its README into a dossier (see lib/codex.ts); this page is the
// growing atlas of those dossiers. Unique, citable content for every charted
// system, and the public face of the discovery loop: charting is progress.
import type { Metadata } from "next";
import Link from "next/link";
import Masthead from "@/components/Masthead";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import JsonLd, { codexGraph } from "@/components/JsonLd";
import { listCodexes, getCachedCodex } from "@/lib/codex";
import { ghAvatar } from "@/lib/avatar";

export const revalidate = 600;

export const metadata: Metadata = {
  alternates: { canonical: "/codex" },
  title: "The Codex · charted systems · Warpchart",
  description:
    "The Warpchart Codex: a growing atlas of GitHub repositories, each charted into a short system dossier. Browse the systems explorers have discovered on the ascent to the galactic core.",
};

const RECENT = 12; // cards with a tagline; the rest list as compact links

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function isToday(iso: string, todayUTC: string): boolean {
  return iso.slice(0, 10) === todayUTC;
}

export default async function CodexIndex() {
  const listing = await listCodexes();
  const todayUTC = new Date().toISOString().slice(0, 10);
  const todayCount = listing.filter((e) => isToday(e.chartedAt, todayUTC)).length;

  // taglines for the most recent systems (cheap: a handful of cached reads)
  const recent = await Promise.all(
    listing.slice(0, RECENT).map(async (e) => ({ ...e, codex: await getCachedCodex(e.repo) })),
  );
  const rest = listing.slice(RECENT);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1120px] flex-col gap-12 px-4 py-12 sm:px-6">
      <JsonLd data={codexGraph(listing)} />
      <SpaceBackdrop mode="scan" />
      <header className="rise" style={{ animationDelay: "0ms" }}>
        <Masthead />
      </header>

      <section className="rise flex flex-col gap-4" style={{ animationDelay: "60ms" }}>
        <h1 className="glow-star font-display text-[clamp(1.7rem,3vw,2.6rem)] leading-tight tracking-[0.06em] text-star">
          THE CODEX
        </h1>
        <p className="max-w-[680px] text-lg font-light leading-relaxed text-dim">
          Every system on the ascent has a story. The first explorer to open a system charts it:
          its README becomes a short dossier in the ship&apos;s log. This is the atlas of
          everything charted so far.
        </p>
        <p className="numeral text-label tracking-[0.18em] text-faint">
          {listing.length > 0 ? (
            <>
              {listing.length.toLocaleString("en-US")} systems charted
              {todayCount > 0 ? (
                <span className="text-accent"> · {todayCount} today</span>
              ) : null}
            </>
          ) : (
            "no systems charted yet · be the first explorer"
          )}
        </p>
      </section>

      {recent.length ? (
        <section className="rise flex flex-col gap-3" style={{ animationDelay: "120ms" }}>
          <h2 className="font-display text-title tracking-[0.14em] text-ink">RECENTLY CHARTED</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {recent.map((e) => {
              const owner = e.repo.split("/")[0];
              return (
                <Link
                  key={e.repo}
                  prefetch={false}
                  href={`/r/${e.repo}`}
                  className="hud group flex gap-3 px-4 py-3.5 transition-colors hover:border-accent/40"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ghAvatar(owner)}
                    alt=""
                    aria-hidden
                    width={40}
                    height={40}
                    className="h-10 w-10 shrink-0 border border-grid"
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="numeral truncate text-sm text-ink group-hover:text-accent">
                        {e.repo}
                      </span>
                      <span className="numeral shrink-0 text-micro text-faint">
                        {isToday(e.chartedAt, todayUTC) ? (
                          <span className="text-accent">today</span>
                        ) : (
                          shortDate(e.chartedAt)
                        )}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm font-light leading-snug text-dim">
                      {e.codex?.tagline ?? "a system awaiting its full dossier"}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {rest.length ? (
        <section className="rise flex flex-col gap-3" style={{ animationDelay: "200ms" }}>
          <h2 className="font-display text-title tracking-[0.14em] text-ink">
            ALL CHARTED SYSTEMS
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((e) => (
              <Link
                key={e.repo}
                prefetch={false}
                href={`/r/${e.repo}`}
                className="hud group flex items-baseline justify-between gap-2 px-3 py-2.5 transition-colors hover:border-accent/40"
              >
                <span className="numeral min-w-0 truncate text-sm text-dim group-hover:text-accent">
                  {e.repo}
                </span>
                <span className="numeral shrink-0 text-micro text-faint">
                  {shortDate(e.chartedAt)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {listing.length === 0 ? (
        <section className="rise flex flex-col items-start gap-4" style={{ animationDelay: "120ms" }}>
          <p className="text-base font-light leading-relaxed text-dim">
            The atlas is empty. Open any system and read its transmission to chart the first one.
          </p>
          <Link
            prefetch={false}
            href="/"
            className="numeral border border-accent/50 bg-accent/10 px-5 py-2.5 text-label tracking-[0.2em] text-accent transition-colors hover:bg-accent/20"
          >
            EXPLORE SYSTEMS →
          </Link>
        </section>
      ) : null}

      <footer className="rise mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-grid pt-4" style={{ animationDelay: "280ms" }}>
        <Link href="/" className="numeral text-micro tracking-[0.15em] text-accent/80 transition-colors hover:text-accent">
          ← EXPLORE SYSTEMS
        </Link>
        <span className="numeral text-micro text-faint">
          WARPCHART · every charted system is a unique dossier
        </span>
      </footer>
    </main>
  );
}
