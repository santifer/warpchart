// The home's "what else warpchart does" band: the live CLI demo plus the three
// open surfaces (ask, rising directory, docs). Surfaces the recommendation and
// distribution layer right where people land, and funnels to /find, /c and /docs.
import Link from "next/link";
import CliDemo from "./CliDemo";

const CARDS = [
  {
    href: "/find",
    title: "Ask for the best X",
    body: "“The best agentic memory system?” Get the repos developers are choosing, ranked by adoption and momentum.",
    cta: "Ask warpchart →",
  },
  {
    href: "/c",
    title: "Where software is moving",
    body: "The rising repositories by domain, AI, CLI, databases and more, ordered by the momentum the whole category is gaining.",
    cta: "Browse rising →",
  },
  {
    href: "/docs",
    title: "API · MCP · CLI",
    body: "Query it all from your shell, your code, or an AI agent. Free, cache-only, no token. Your agent can ask too.",
    cta: "Read the docs →",
  },
];

export default function CapabilitiesBand() {
  return (
    <section className="flex flex-col gap-4 px-1">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-title tracking-[0.14em] text-ink">USE IT ANYWHERE</h2>
        <p className="max-w-[680px] text-label font-light leading-relaxed text-dim">
          Warpchart is the present tense of open source: the live signal of what humans are choosing.
          Ask it from the web, your terminal, or an agent.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CliDemo />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {CARDS.map((c) => (
            <Link
              key={c.href}
              prefetch={false}
              href={c.href}
              className="hud flex flex-col gap-1.5 px-4 py-4 transition-colors hover:border-accent/40"
            >
              <span className="font-display text-title tracking-[0.04em] text-ink">{c.title}</span>
              <span className="text-label font-light leading-relaxed text-dim">{c.body}</span>
              <span className="numeral mt-0.5 text-micro tracking-[0.15em] text-accent">{c.cta}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
