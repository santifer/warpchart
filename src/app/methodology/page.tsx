// Methodology + provenance. The E-E-A-T anchor: who runs Warpchart, where the
// data comes from, how every number is computed, and the honest limits. Written
// as question-form sections (high AI-citation value) and mirrored into a
// FAQPage JSON-LD so the same facts are machine-readable. Static.
import type { Metadata } from "next";
import Link from "next/link";
import Masthead from "@/components/Masthead";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import JsonLd, { ORG_ID } from "@/components/JsonLd";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Methodology · how Warpchart measures GitHub growth · Warpchart",
  description:
    "How Warpchart computes worldwide GitHub rank, star velocity and overtake ETAs: the data sources, the daily worldwide distribution, the 7-day velocity, the refresh cadence, and the honest limits. Built on public GitHub data; the data is never for sale.",
  alternates: { canonical: "/methodology" },
};

// One source of truth for the visible Q&A and the FAQPage JSON-LD.
const QA: { q: string; a: string }[] = [
  {
    q: "What is Warpchart?",
    a: "Warpchart is a developer tool that ranks every public GitHub repository by worldwide star rank and growth velocity, live and free. It answers, for any repo, where it stands among all of GitHub, how fast it is climbing, and which repositories are closing in on it.",
  },
  {
    q: "Where does the data come from?",
    a: "Only public GitHub data, read through GitHub's official GraphQL and REST APIs. Warpchart adds no private or proprietary inputs. Every public page reads daily-refreshed caches, so browsing never burns GitHub quota.",
  },
  {
    q: "How is worldwide rank computed?",
    a: "Once a day Warpchart records the star distribution of the worldwide top of GitHub (the top ~10,000 repositories). A repository's worldwide rank is its position by star count within that recorded distribution. Below the recorded band the rank is an estimate; inside it, it is exact for that day.",
  },
  {
    q: "How is growth velocity (stars per day) computed?",
    a: "The headline velocity is a trailing 7-day rate: the change in stars over the last seven days, divided by seven, computed from the recorded daily distribution. A 7-day window is used deliberately because a 1-day rate is noisy; seven days is stable enough to compare repositories fairly.",
  },
  {
    q: "How are overtake ETAs and the race projected?",
    a: "An ETA is a straight projection: the star gap between two repositories divided by the difference in their velocities. It assumes today's pace holds, so it is an estimate, not a promise — it moves as the pace moves. A meeting is only projected when the repository that is behind is the faster one.",
  },
  {
    q: "How fresh are the numbers, and how often do they update?",
    a: "The worldwide distribution is recorded once a day. The collector refreshes the registry roughly every two hours. A tracked repository's own history is sampled hourly. Public dossiers are cached for about 15 minutes. So a repository's live counters are minutes old; its worldwide-rank history advances one point per day.",
  },
  {
    q: "Why does the worldwide-rank history only go back a few days for some repos?",
    a: "Worldwide rank requires a snapshot of the entire distribution on a given day, and Warpchart shows it from the day it started recording that distribution. The underlying events can be approximately reconstructed from public archives like GH Archive, but those reconstructions drift: they miss un-stars, can double-count, and GitHub's API returns only current stargazers. So a reconstruction is an estimate, not the authoritative daily rank Warpchart captures live. The history grows by one point every day. A repository's raw star history, by contrast, goes back to its creation.",
  },
  {
    q: "Is a star the same as an endorsement?",
    a: "No. A star is a signal of attention, not always of validated use. Warpchart pairs stars with derived signals — velocity, fork ratio, real installs and clones where available — precisely because the raw count alone can mislead.",
  },
  {
    q: "Who builds and runs Warpchart?",
    a: "Warpchart is built and maintained by Santiago Fernández (santifer on GitHub). It is open source under the MIT license and can be self-hosted; the public console you see is the same code anyone can run.",
  },
  {
    q: "Do you sell the data?",
    a: "No. The data is never for sale at any price. The paid product sells operations — hosting the collector, keeping exact hourly history, and preserving the traffic GitHub deletes every 14 days. Paying never changes a single number on any public chart.",
  },
];

function Section({ q, a, delay }: { q: string; a: string; delay: number }) {
  return (
    <section className="rise flex flex-col gap-2" style={{ animationDelay: `${delay}ms` }}>
      <h2 className="font-display text-title leading-snug tracking-[0.08em] text-ink">{q}</h2>
      <p className="max-w-[760px] text-base font-light leading-relaxed text-dim">{a}</p>
    </section>
  );
}

export default function MethodologyPage() {
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": "https://warpchart.dev/methodology#faq",
    isPartOf: { "@id": "https://warpchart.dev/#website" },
    about: { "@id": ORG_ID },
    mainEntity: QA.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-[920px] flex-col gap-9 px-4 py-8 sm:px-6">
      <JsonLd data={faqLd} />
      <SpaceBackdrop mode="scan" />
      <header className="rise" style={{ animationDelay: "0ms" }}>
        <Masthead demo={null} />
      </header>

      <section className="rise flex flex-col gap-3" style={{ animationDelay: "60ms" }}>
        <h1 className="font-display text-[clamp(1.6rem,4vw,2.6rem)] leading-tight tracking-[0.08em] text-star">
          METHODOLOGY
        </h1>
        <p className="max-w-[760px] text-base font-light leading-relaxed text-dim">
          How Warpchart measures open source. Every number on the site is derived from public GitHub
          data through a transparent method, with the limits stated plainly. If a figure cannot be
          known honestly, Warpchart does not invent it.
        </p>
      </section>

      {QA.map((item, i) => (
        <Section key={item.q} q={item.q} a={item.a} delay={120 + i * 40} />
      ))}

      <footer className="rise flex flex-wrap items-center justify-between gap-2 pb-4 pt-2" style={{ animationDelay: "560ms" }}>
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          WARPCHART · by the maker of{" "}
          <Link href="https://career-ops.org" className="text-accent/80 transition-colors hover:text-accent">
            career-ops
          </Link>
        </span>
        <Link prefetch={false} href="https://github.com/santifer/warpchart" className="numeral text-micro text-faint hover:text-dim">
          source on github →
        </Link>
      </footer>
    </main>
  );
}
