// Ask warpchart in plain language: "what is the best agentic memory system?"
// Server-rendered over the cache-only catalog (zero GitHub calls), so it is
// fast and indexable. The same answer the CLI and the recommend MCP tool give:
// the present-tense pick a trained model cannot make, ranked by what developers
// are actually choosing and how fast it is climbing.
import type { Metadata } from "next";
import Link from "next/link";
import Masthead from "@/components/Masthead";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import { searchRepos } from "@/lib/search";
import { catalogMeta } from "@/lib/catalog";
import { fmtCompact } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ask warpchart · the best GitHub repo for any need · Warpchart",
  description:
    "Ask in plain language, like 'the best agentic memory system' or 'a fast vector database', and get the GitHub repos that match, ranked by how broadly they are adopted and how fast they are climbing. Live, free, from the worldwide catalog.",
  alternates: { canonical: "/find" },
  openGraph: { images: ["/api/og"] },
};

const SUGGESTIONS = [
  "best agentic memory system",
  "vector database for rag",
  "tui framework",
  "llm observability",
  "web framework in rust",
  "self-hosted analytics",
];

export default async function FindPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const results = query ? searchRepos(query, 25).results : [];
  const { asOf } = catalogMeta();
  const day = (asOf ?? "").slice(0, 10);

  return (
    <main className="mx-auto flex min-h-screen max-w-[960px] flex-col gap-8 px-4 py-8 sm:px-6">
      <SpaceBackdrop mode="scan" />
      <header className="rise" style={{ animationDelay: "0ms" }}>
        <Masthead demo={null} />
      </header>

      <section className="rise flex flex-col gap-3" style={{ animationDelay: "60ms" }}>
        <h1 className="font-display text-[clamp(1.6rem,4vw,2.6rem)] leading-tight tracking-[0.08em] text-star">
          ASK WARPCHART
        </h1>
        <p className="max-w-[680px] text-base font-light leading-relaxed text-dim">
          Describe what you need. We answer with the repositories developers are actually choosing for
          it right now, ranked by adoption and momentum. The present-tense pick a trained model cannot
          make.
        </p>
        {/* plain GET form: works without JS, navigates to /find?q= */}
        <form action="/find" method="get" className="flex w-full max-w-[620px] gap-2">
          <input
            type="text"
            name="q"
            defaultValue={query}
            autoFocus
            placeholder="best agentic memory system"
            aria-label="Describe what you need"
            className="hud min-w-0 flex-1 bg-transparent px-4 py-3 text-label text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none"
          />
          <button
            type="submit"
            className="hud numeral px-4 py-3 text-micro tracking-[0.2em] text-accent transition-colors hover:border-accent/60"
          >
            ASK →
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <Link
              key={s}
              prefetch={false}
              href={`/find?q=${encodeURIComponent(s)}`}
              className="numeral text-micro tracking-[0.08em] text-faint underline-offset-4 transition-colors hover:text-accent hover:underline"
            >
              {s}
            </Link>
          ))}
        </div>
      </section>

      {query ? (
        <section className="rise flex flex-col gap-2" style={{ animationDelay: "120ms" }}>
          <p className="numeral text-micro tracking-[0.15em] text-faint">
            {results.length ? `top matches for "${query}"` : `nothing in the catalog matches "${query}" yet`}
            {day ? ` · catalog of ${day}` : ""}
          </p>
          <ol className="flex flex-col gap-2">
            {results.map((e, i) => (
              <li key={e.repo}>
                <Link
                  prefetch={false}
                  href={`/r/${e.repo}`}
                  className="hud flex flex-col gap-1 px-4 py-3 transition-colors hover:border-accent/40 sm:flex-row sm:items-center sm:gap-4"
                >
                  <span className="numeral w-8 shrink-0 text-label text-faint">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="truncate font-display text-title tracking-[0.04em] text-ink">{e.repo}</span>
                      {e.language ? (
                        <span className="numeral text-micro tracking-[0.12em] text-faint">{e.language}</span>
                      ) : null}
                    </span>
                    {e.description ? (
                      <span className="line-clamp-1 text-label font-light text-dim">{e.description}</span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-4 numeral">
                    <span className="text-label text-dim">{fmtCompact(e.stars)} ★</span>
                    {e.velocityPerDay > 0 ? (
                      <span className="text-label text-accent">▲ {e.velocityPerDay}/day</span>
                    ) : (
                      <span className="text-micro text-faint">#{e.rank}</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <footer className="rise flex flex-wrap items-center justify-between gap-2 pb-4 pt-2">
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          also from your shell: <span className="text-dim">npx warpchart find &quot;...&quot;</span> · or the MCP server
        </span>
        <Link prefetch={false} href="/docs" className="numeral text-micro text-faint hover:text-dim">
          api · mcp · cli docs →
        </Link>
      </footer>
    </main>
  );
}
