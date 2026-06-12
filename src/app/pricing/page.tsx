// Mission plans. The social contract is explicit: the public explorer and
// the software are free forever; money buys OPERATIONS (exact history
// collected for you, alerts, zero ops) or supports independence. Data is
// never for sale at any price.
import type { Metadata } from "next";
import Link from "next/link";
import { loadMeta } from "@/lib/history";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Pricing · Warpchart",
  description:
    "Self-host Warpchart free, or get your repository tracked with exact hourly history, alerts and zero ops. The public explorer stays free forever; the data is never for sale.",
};

// Polar checkout links land here the moment the account is live; until
// then the claim CTA routes to email with a 24h provisioning promise.
const CHECKOUT = {
  hosted: null as string | null,
  fleet: null as string | null,
};
const CLAIM_MAIL = (plan: string) =>
  `mailto:hola@santifer.io?subject=${encodeURIComponent(`warpchart ${plan}: track my repo`)}&body=${encodeURIComponent(
    "Repo (owner/name):\n\nYour mission goes live within 24h of payment setup."
  )}`;

const PLANS = [
  {
    name: "SELF-HOST",
    price: "FREE",
    cadence: "forever",
    accent: false,
    perks: [
      "The full console: chart, replay, sound, deck",
      "MIT template, deploy on your own Vercel",
      "Your collector, your GitHub quota, your data",
      "Community support",
    ],
    cta: { label: "USE THE TEMPLATE →", href: "https://github.com/santifer/warpchart" },
    note: "DIY: you run the ops.",
  },
  {
    name: "HOSTED MISSION",
    price: "$19",
    cadence: "per repo / month",
    accent: true,
    perks: [
      "Exact hourly history from the day you join (it cannot be backfilled later: GitHub caps history and archives miss viral bursts)",
      "Unlocked live console at warpchart.dev/r/your/repo",
      "Live replay with the synthesized soundtrack",
      "Alerts: gate crossings and incoming hunters (Discord, Slack, RSS)",
      "Exact live counter on your README embed and badge",
      "Zero ops: we run the collector on your repo's own App quota",
    ],
    cta: { label: "TRACK THIS REPO →", href: CHECKOUT.hosted ?? CLAIM_MAIL("hosted mission") },
    note: "Live within 24h.",
  },
  {
    name: "FLEET",
    price: "$79",
    cadence: "up to 10 repos / month",
    accent: false,
    perks: [
      "Everything in Hosted Mission, for your org's fleet",
      "All your missions on one wall",
      "Priority support",
      "Direct line for feature requests (heard, never sold)",
    ],
    cta: { label: "ASSEMBLE YOUR FLEET →", href: CHECKOUT.fleet ?? CLAIM_MAIL("fleet") },
    note: "For orgs: the employer pays, maintainers never do.",
  },
];

export default function Pricing() {
  const meta = loadMeta();
  return (
    <main className="mx-auto flex min-h-screen max-w-[1000px] flex-col gap-10 px-4 py-10 sm:px-6">
      <header className="rise flex items-center justify-between" style={{ animationDelay: "0ms" }}>
        <Link href="/explore" className="font-display text-sm tracking-[0.3em] text-star hover:text-accent">
          WARPCHART
        </Link>
        <span className="numeral text-micro tracking-[0.2em] text-dim">MISSION PLANS</span>
      </header>

      <section className="rise flex flex-col gap-4" style={{ animationDelay: "80ms" }}>
        <h1 className="font-display text-xl leading-snug tracking-[0.08em] text-ink sm:text-2xl">
          RUN YOUR OWN MISSION
        </h1>
        <p className="max-w-[680px] text-sm font-light leading-relaxed text-dim">
          The public explorer is free for any repo, forever. The software is MIT and
          self-hostable, forever. What costs money is the operation we run for you, and
          the one thing nobody can backfill later: your exact history, collected hour by
          hour from the day your mission starts.
        </p>
        <div className="hud max-w-[680px] px-4 py-3">
          <p className="numeral text-data leading-relaxed text-ink">
            THE DATA IS NEVER FOR SALE. Paying never moves a pixel of any chart: not
            yours, not anyone&apos;s. You buy operations and convenience, not position.
          </p>
        </div>
      </section>

      <section className="rise grid grid-cols-1 gap-3 md:grid-cols-3" style={{ animationDelay: "160ms" }}>
        {PLANS.map((p) => (
          <div
            key={p.name}
            className={`hud flex flex-col gap-4 px-5 py-5 ${p.accent ? "border-accent/60" : ""}`}
          >
            <div>
              <div className={`numeral text-label tracking-[0.25em] ${p.accent ? "text-accent" : "text-dim"}`}>
                {p.name}
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="numeral text-2xl font-semibold text-ink">{p.price}</span>
                <span className="numeral text-micro tracking-[0.15em] text-faint">{p.cadence}</span>
              </div>
            </div>
            <ul className="flex flex-col gap-2">
              {p.perks.map((perk) => (
                <li key={perk} className="flex gap-2 text-data font-light leading-relaxed text-dim">
                  <span className={p.accent ? "text-accent" : "text-faint"}>◆</span>
                  <span>{perk}</span>
                </li>
              ))}
            </ul>
            <div className="mt-auto flex flex-col gap-2">
              <a
                href={p.cta.href}
                target={p.cta.href.startsWith("http") ? "_blank" : undefined}
                rel={p.cta.href.startsWith("http") ? "noopener noreferrer" : undefined}
                className={`numeral border px-4 py-2.5 text-center text-label tracking-[0.18em] transition-colors ${
                  p.accent
                    ? "border-accent/60 text-accent hover:bg-accent/10"
                    : "border-grid text-dim hover:border-accent/50 hover:text-accent"
                }`}
              >
                {p.cta.label}
              </a>
              <span className="numeral text-center text-micro tracking-[0.12em] text-faint">{p.note}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="rise flex flex-col gap-3" style={{ animationDelay: "240ms" }}>
        <h2 className="module-title">NOT A CUSTOMER, A PATRON?</h2>
        <p className="max-w-[680px] text-data font-light leading-relaxed text-dim">
          If you just want the public telemetry to stay free and independent, that path
          exists too: sponsorship funds the mission and buys exactly zero influence.
        </p>
        <a
          href="https://github.com/sponsors/santifer"
          target="_blank"
          rel="noopener noreferrer"
          className="hud flex max-w-[680px] items-center justify-center border-dashed px-4 py-3 transition-colors hover:border-accent/50"
        >
          <span className="numeral text-label tracking-[0.2em] text-accent">
            BECOME A MISSION PATRON · from $5/mo →
          </span>
        </a>
      </section>

      {meta ? (
        <section className="rise flex flex-col gap-2" style={{ animationDelay: "300ms" }}>
          <h2 className="module-title">SEE A LIVE HOSTED MISSION</h2>
          <Link
            href={`/r/${meta.repo}`}
            className="numeral text-data text-accent/90 hover:text-accent"
          >
            {meta.repo} · the demo tenant runs on this exact plan →
          </Link>
        </section>
      ) : null}

      <footer className="rise mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-grid pt-4" style={{ animationDelay: "360ms" }}>
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          WARPCHART · open telemetry over public GitHub data
        </span>
        <Link href="/explore" className="numeral text-micro text-accent/80 hover:text-accent">
          ← EXPLORE
        </Link>
      </footer>
    </main>
  );
}
