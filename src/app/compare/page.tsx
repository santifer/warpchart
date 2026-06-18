// THE RACE: compare the star growth of any set of public repos side by side.
// All data is the same cached reconstruction the embed and OG card use, so
// traffic never multiplies GitHub cost. URL-stateful (?repos=a/b,c/d) so every
// comparison is a shareable link that unfurls into a designed OG card.
import type { Metadata } from "next";
import Masthead from "@/components/Masthead";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import CompareLab from "@/components/CompareLab";
import { loadMeta } from "@/lib/history";
import { parseRepos, shortRepo } from "@/lib/compare";

export const dynamic = "force-dynamic";

type SP = Promise<{ repos?: string; metric?: string; align?: string; log?: string }>;

function resolveRepos(repos?: string): string[] {
  const fromUrl = parseRepos(repos);
  if (fromUrl.length) return fromUrl;
  return [loadMeta()?.repo ?? "santifer/career-ops"];
}

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const sp = await searchParams;
  const list = resolveRepos(sp.repos);
  const names = list.map(shortRepo).join(" vs ");
  const title = `${names} · Star race · Warpchart`;
  return {
    // self-canonical on the normalized repo list (resolveRepos dedupes/orders),
    // so "a vs b" and "b vs a" consolidate to one indexable comparison URL
    alternates: { canonical: list.length ? `/compare?repos=${list.join(",")}` : "/compare" },
    title,
    description: `Compare the GitHub star growth of ${list.join(", ")} side by side: cumulative stars, growth rate, day-zero alignment and world rank.`,
    openGraph: {
      title,
      images: [`/api/og?compare=${encodeURIComponent(list.join(","))}`],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function ComparePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const initialRepos = resolveRepos(sp.repos);
  const initialMetric = sp.metric === "growth" ? "growth" : "cumulative";
  const initialAlign = sp.align === "1";
  const initialLog = sp.log === "1";

  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-5 px-3 py-4 sm:px-6 sm:py-6">
      <SpaceBackdrop mode="scan" />
      <div className="px-1">
        <Masthead />
      </div>

      <header className="px-1">
        <h1 className="font-display text-lg tracking-[0.18em] text-star uppercase">The Race</h1>
        <p className="mt-1 max-w-[68ch] text-sm font-light text-dim">
          Chart any repositories&apos; climb side by side. Cumulative stars or growth rate,
          aligned by calendar or by day zero. Every point is a real stargazer timestamp,
          reconstructed and cached. Share the link and it carries the chart with it.
        </p>
      </header>

      <CompareLab
        initialRepos={initialRepos}
        initialMetric={initialMetric}
        initialAlign={initialAlign}
        initialLog={initialLog}
      />

      <footer className="flex flex-wrap items-center justify-between gap-2 px-1 pb-4 pt-2">
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          WARPCHART · open telemetry over public GitHub data
        </span>
        <span className="numeral text-micro text-faint">no signup · free · sponsor-supported</span>
      </footer>
    </main>
  );
}
