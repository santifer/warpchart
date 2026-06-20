// A category page in the rising directory: the repositories climbing fastest
// in one domain right now, by momentum (not raw stars). Built entirely from the
// cache-only catalog (data/catalog.json) -> zero API cost, statically rendered,
// refreshed with each daily catalog. Each entry links to its console; the JSON
// feed serves agents and investors. This is the free L0 tier of the
// intelligence ladder: discovery that funnels to the deeper product.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Masthead from "@/components/Masthead";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import { categoryById, risingInCategory, catalogMeta } from "@/lib/catalog";
import { listCategories } from "@/lib/catalog";
import { fmtCompact } from "@/lib/format";

// 6h: the catalog is daily, this page only reads fs, zero API cost.
export const revalidate = 21600;

// Prerender every category that currently has members; the long tail / unknown
// slugs render on-demand (and 404 if empty).
export async function generateStaticParams() {
  return listCategories().categories.map((c) => ({ topic: c.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<Metadata> {
  const { topic } = await params;
  const cat = categoryById(topic);
  if (!cat) return { title: "Category · Warpchart" };
  const title = `Rising ${cat.label} repositories, updated daily · Warpchart`;
  const description =
    `The ${cat.label} repositories on GitHub climbing fastest right now, ranked by momentum (stars per day), not just total stars. ` +
    `Live and free, from the worldwide rank distribution Warpchart records every day.`;
  return {
    title,
    description,
    alternates: { canonical: `/c/${cat.id}` },
    openGraph: { title, description, images: ["/api/og"] },
  };
}

function FeedLink({ id }: { id: string }) {
  // a JSON endpoint, not a page: plain anchor with the href in a variable so the
  // no-html-link-for-pages heuristic does not treat the feed as an app route.
  const href = `/api/v1/rising?topic=${encodeURIComponent(id)}`;
  return (
    <a
      href={href}
      className="numeral mt-1 inline-flex w-fit items-center gap-2 border border-grid px-3 py-1.5 text-micro tracking-[0.15em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
    >
      ▸ FOR AGENTS &amp; INVESTORS · GET THIS AS JSON
    </a>
  );
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  const cat = categoryById(topic);
  const rising = risingInCategory(topic, 40);
  if (!cat || !rising.length) notFound();

  const { asOf } = catalogMeta();
  const day = (asOf ?? "").slice(0, 10);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1120px] flex-col gap-8 px-4 py-8 sm:px-6">
      <SpaceBackdrop mode="raceway" />
      <header className="rise" style={{ animationDelay: "0ms" }}>
        <Masthead demo={null} />
      </header>

      <section className="rise flex flex-col gap-2" style={{ animationDelay: "60ms" }}>
        <Link prefetch={false} href="/c" className="numeral text-micro tracking-[0.15em] text-faint hover:text-dim">
          ← ALL CATEGORIES
        </Link>
        <h1 className="font-display text-[clamp(1.6rem,4vw,2.6rem)] leading-tight tracking-[0.08em] text-star">
          RISING · {cat.label.toUpperCase()}
        </h1>
        <p className="max-w-[720px] text-base font-light leading-relaxed text-dim">
          {cat.blurb ? cat.blurb + " " : ""}The {cat.label} repositories breaking out right now, ranked by
          relative momentum: daily growth against their own size, so real risers surface instead of the giants that
          merely add the most stars in absolute terms.
        </p>
        <p className="numeral text-micro tracking-[0.15em] text-faint">
          {day ? `catalog of ${day} · ` : ""}velocity is a trailing pace, up to 7 days · the one history nobody else keeps
        </p>
        <FeedLink id={cat.id} />
      </section>

      <section className="rise flex flex-col gap-2" style={{ animationDelay: "120ms" }}>
        <ol className="flex flex-col gap-2">
          {rising.map((e, i) => (
            <li key={e.repo}>
              <Link
                prefetch={false}
                href={`/r/${e.repo}`}
                className="hud flex flex-col gap-1 px-4 py-3 transition-colors hover:border-accent/40 sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="numeral w-10 shrink-0 text-label text-faint">{String(i + 1).padStart(2, "0")}</span>
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
                  {e.growthPctDay > 0 ? (
                    <span className="flex items-baseline gap-2">
                      <span className="text-label text-accent">▲ {e.growthPctDay}%/day</span>
                      <span className="text-micro text-faint">{fmtCompact(e.velocityPerDay)}/d</span>
                    </span>
                  ) : e.velocityPerDay > 0 ? (
                    <span className="text-label text-accent">▲ {fmtCompact(e.velocityPerDay)}/day</span>
                  ) : (
                    <span className="text-micro text-faint">#{e.rank}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <footer className="rise flex flex-wrap items-center justify-between gap-2 pb-4 pt-2">
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          WARPCHART · the present tense of open source
        </span>
        <Link prefetch={false} href="/c" className="numeral text-micro text-faint hover:text-dim">
          all categories →
        </Link>
      </footer>
    </main>
  );
}
