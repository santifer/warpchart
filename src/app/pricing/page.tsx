// Mission plans. Two modes:
//   /pricing            -> the generic offer (self-host vs hosted vs fleet)
//   /pricing?repo=o/n   -> the SAME offer, re-told around one repo: its live
//                          rank, velocity, the gap to its next gate, the repos
//                          hunting it, and what its hourly history is worth.
// The personalized page reads the exact cached snapshot the visitor just saw on
// /r/owner/name (loadExplorerData: shared cache, matching numbers, ~zero extra
// GitHub cost), so the plan feels measured for them, not pitched at them. The
// data is never for sale at any price; money buys operations.
import type { Metadata } from "next";
import Link from "next/link";
import { loadMeta } from "@/lib/history";
import { loadExplorerData, type ExplorerData } from "@/lib/explorer";
import { fmt, fmtEtaDays } from "@/lib/format";
import SpaceBackdrop from "@/components/SpaceBackdrop";

// Dynamic: the page reads ?repo=. The expensive GitHub work is paid at most
// once per repo per 15 min inside loadExplorerData, so render stays cheap.
export const dynamic = "force-dynamic";

const SEG = /^[\w.-]+$/;
const FULL = /^[\w.-]+\/[\w.-]+$/;

interface Plan {
  name: string;
  price: string;
  cadence: string;
  accent?: boolean;
  tag?: string;
  perks: string[];
  cta: { label: string; href: string };
  note: string;
}

async function resolveRepo(repoParam?: string): Promise<NonNullable<ExplorerData> | null> {
  if (!repoParam) return null;
  const trimmed = repoParam.trim();
  const [owner, name] = trimmed.split("/");
  if (!owner || !name || !SEG.test(owner) || !SEG.test(name)) return null;
  try {
    return await loadExplorerData(owner, name);
  } catch {
    return null; // pricing never errors out; fall back to the generic offer
  }
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string }>;
}): Promise<Metadata> {
  const { repo } = await searchParams;
  const valid = repo && FULL.test(repo.trim()) ? repo.trim() : null;
  if (valid) {
    return {
      title: `Chart ${valid} · Warpchart`,
      description: `Track ${valid} with exact hourly history, world-rank trajectory, hunter ETAs and alerts. The public explorer stays free; your history is yours forever.`,
      openGraph: { images: [`/api/og?repo=${valid}`] },
    };
  }
  return {
    title: "Pricing · Warpchart",
    description:
      "Self-host Warpchart free, or get your repository tracked with exact hourly history, alerts and zero ops. The public explorer stays free forever; the data is never for sale.",
  };
}

// ---- generic offer (no ?repo=) -------------------------------------------
const GENERIC_PLANS: Plan[] = [
  {
    name: "SELF-HOST",
    price: "FREE",
    cadence: "forever",
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
    cta: { label: "TRACK THIS REPO →", href: "/api/checkout?plan=hosted" },
    note: "Live within 24h.",
  },
  {
    name: "FLEET",
    price: "$79",
    cadence: "up to 10 repos / month",
    perks: [
      "Everything in Hosted Mission, for your org's fleet",
      "All your missions on one wall",
      "Priority support",
      "Direct line for feature requests (heard, never sold)",
    ],
    cta: { label: "ASSEMBLE YOUR FLEET →", href: "/api/checkout?plan=fleet" },
    note: "For orgs: the employer pays, maintainers never do.",
  },
];

// ---- personalized offer (?repo=owner/name) --------------------------------
function personalizedPlans(d: NonNullable<ExplorerData>): Plan[] {
  const repoLabel = d.inputs.repo;
  const owner = repoLabel.split("/")[0] ?? repoLabel;
  const name = repoLabel.split("/")[1] ?? repoLabel;
  const NAME = name.toUpperCase().slice(0, 22);
  const OWNER = owner.toUpperCase().slice(0, 22);
  const next = d.inputs.milestones[0] ?? null;

  const hunters = d.neighbors
    .filter((n) => n.s < d.inputs.stars)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
    .map((n) => n.r.split("/")[1] ?? n.r);

  const huntersPerk = hunters.length
    ? `Who's hunting ${name}: live gaps and ETAs on ${hunters.join(" and ")}, and every repo closing in`
    : `Live gaps and ETAs on every repo closing in on ${name}`;
  const gatePerk = next
    ? `Alerts the moment a hunter closes in or ${name} breaks into the top ${fmt(next.rank)} (Discord, Slack, RSS)`
    : `Alerts the moment a hunter closes in or ${name} crosses its next gate (Discord, Slack, RSS)`;

  return [
    {
      name: "RECON",
      price: "FREE",
      cadence: "forever",
      perks: [
        `The live snapshot of ${name} you're looking at now`,
        "Public console, ranking neighbors and the reconstructed curve",
        "MIT template: self-host and run your own collector",
        "Community support",
      ],
      cta: { label: `← KEEP EXPLORING ${NAME}`, href: `/r/${repoLabel}` },
      note: "What anyone can see, free, always.",
    },
    {
      name: "HOSTED MISSION",
      price: "$19",
      cadence: "per month",
      accent: true,
      tag: `RECOMMENDED FOR ${NAME}`,
      perks: [
        `Exact hourly history of ${name} from day one (GitHub caps history and archives miss viral bursts: it cannot be backfilled later)`,
        `${name}'s full console unlocked: world-rank trajectory, daily ladder, heatmap and spike forensics`,
        huntersPerk,
        `Milestone log: every gate ${name} crosses, timestamped forever`,
        `Exact live star counter on ${name}'s README badge and embed`,
        gatePerk,
        "Live replay with the synthesized soundtrack · zero ops, we run it",
      ],
      cta: {
        label: `TRACK ${NAME} · $19/MO →`,
        href: `/api/checkout?repo=${encodeURIComponent(repoLabel)}&plan=hosted`,
      },
      note: "Live within 24h. Cancel anytime.",
    },
    {
      name: "FLEET",
      price: "$79",
      cadence: "up to 10 repos / month",
      perks: [
        `Everything in Hosted Mission, for all of ${owner}'s repos`,
        "The whole fleet on one wall",
        "Traffic Vault: clones, views and referrers snapshotted before GitHub erases them every 14 days",
        "Priority support and a direct line for feature requests",
      ],
      cta: {
        label: `ASSEMBLE ${OWNER}'S FLEET →`,
        href: `/api/checkout?repo=${encodeURIComponent(repoLabel)}&plan=fleet`,
      },
      note: "For orgs: the employer pays, maintainers never do.",
    },
  ];
}

function PlanCard({ p }: { p: Plan }) {
  const external = p.cta.href.startsWith("http");
  return (
    <div className={`hud flex flex-col gap-4 px-5 py-5 ${p.accent ? "border-accent/60" : ""}`}>
      <div>
        {p.tag ? (
          <div className="numeral mb-2 inline-block border border-accent/50 bg-accent/10 px-2 py-0.5 text-micro tracking-[0.18em] text-accent">
            {p.tag}
          </div>
        ) : null}
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
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
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
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="module-title !text-micro">{label}</span>
      <span className={`numeral text-lg leading-none ${accent ? "glow-accent text-accent" : "text-ink"}`}>
        {value}
      </span>
    </div>
  );
}

export default async function Pricing({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string }>;
}) {
  const { repo } = await searchParams;
  const data = await resolveRepo(repo);
  const meta = loadMeta();

  // ----- personalized numbers (only when a repo resolved) -----
  let repoLabel = "";
  let repoOwner = "";
  let repoName = "";
  let plans = GENERIC_PLANS;
  let rankStr = "";
  let starsStr = "";
  let vDay = 0;
  let weekly = 0;
  let next: NonNullable<ExplorerData>["inputs"]["milestones"][number] | null = null;
  let gap: number | null = null;
  let eta: string | null = null;

  if (data) {
    repoLabel = data.inputs.repo;
    repoOwner = repoLabel.split("/")[0] ?? repoLabel;
    repoName = repoLabel.split("/")[1] ?? repoLabel;
    plans = personalizedPlans(data);
    rankStr = data.inputs.rank !== null ? `#${fmt(data.inputs.rank)}` : "unranked";
    starsStr = fmt(data.inputs.stars);
    vDay = Math.round(data.inputs.v7d);
    weekly = Math.round(data.inputs.v7d * 7);
    next = data.inputs.milestones[0] ?? null;
    gap = next ? Math.max(0, next.threshold - data.inputs.stars) : null;
    eta = next && gap && gap > 0 && data.inputs.v7d > 0 ? fmtEtaDays(gap / data.inputs.v7d) : null;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[1000px] flex-col gap-10 px-4 py-10 sm:px-6">
      <SpaceBackdrop mode="launch" />

      <header className="rise flex items-center justify-between" style={{ animationDelay: "0ms" }}>
        <Link href="/explore" className="font-display text-sm tracking-[0.3em] text-star hover:text-accent">
          WARPCHART
        </Link>
        {data ? (
          <Link
            href={`/r/${repoLabel}`}
            className="numeral text-micro tracking-[0.18em] text-dim hover:text-accent"
          >
            ← {repoLabel}
          </Link>
        ) : (
          <span className="numeral text-micro tracking-[0.2em] text-dim">MISSION PLANS</span>
        )}
      </header>

      {data ? (
        <>
          {/* personalized hero */}
          <section className="rise flex flex-col gap-5" style={{ animationDelay: "80ms" }}>
            <div className="flex items-start gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://github.com/${repoOwner}.png?size=96`}
                alt=""
                width={48}
                height={48}
                className="h-12 w-12 shrink-0 border border-grid"
              />
              <div className="min-w-0">
                <span className="numeral inline-block border border-grid px-2 py-0.5 text-micro tracking-[0.28em] text-faint">
                  ◌ CURRENTLY UNCHARTED
                </span>
                <h1 className="mt-2 font-display text-xl leading-snug tracking-[0.08em] text-ink sm:text-2xl">
                  CHART {repoName.toUpperCase()}
                </h1>
              </div>
            </div>

            <div className="hud flex flex-wrap gap-x-8 gap-y-4 px-4 py-3">
              <Stat label="Stars" value={starsStr} accent />
              <Stat label="World rank" value={rankStr} />
              <Stat label="Velocity" value={`${fmt(vDay)}/day`} />
              {next && gap !== null && gap > 0 ? (
                <Stat label={`Gap to top ${fmt(next.rank)}`} value={fmt(gap)} />
              ) : null}
            </div>

            <p className="max-w-[680px] text-sm font-light leading-relaxed text-dim">
              <span className="text-ink">{repoName}</span>{" "}
              {data.inputs.rank !== null ? (
                <>
                  sits <span className="text-accent">{rankStr}</span> of every public repository
                </>
              ) : (
                <>is on the board</>
              )}
              {vDay > 0 ? (
                <>
                  , climbing <span className="text-accent">{fmt(vDay)}★/day</span>
                </>
              ) : null}
              {eta && next ? (
                <>
                  {" "}
                  and <span className="text-accent">~{eta}</span> from the top {fmt(next.rank)}
                </>
              ) : null}
              . Right now that is a snapshot. The hour-by-hour record of how it got here, and where it
              is heading, only exists from the moment you start charting it.
            </p>
          </section>

          {/* the loss frame: what is being erased, with their own numbers */}
          <section className="rise" style={{ animationDelay: "140ms" }}>
            <div className="hud flex flex-col gap-2 border-accent/40 px-4 py-3">
              <p className="numeral text-data leading-relaxed text-ink">
                STAR HISTORY CANNOT BE BACKFILLED. GitHub caps how far back it goes and the public
                archives miss viral bursts, so the hour-by-hour truth about {repoName} only exists from
                the day tracking starts.
              </p>
              <p className="text-data font-light leading-relaxed text-dim">
                And GitHub erases your traffic, clones, views and referrers, every 14 days. The Fleet
                vault snapshots them before they are gone.
                {weekly > 0 ? (
                  <>
                    {" "}
                    <span className="text-ink">{repoName}</span> added{" "}
                    <span className="text-accent">~{fmt(weekly)} stars</span> in the last 7 days alone,
                    none of it on a forensic record yet.
                  </>
                ) : null}
              </p>
            </div>
          </section>
        </>
      ) : (
        // generic hero
        <section className="rise flex flex-col gap-4" style={{ animationDelay: "80ms" }}>
          <h1 className="font-display text-xl leading-snug tracking-[0.08em] text-ink sm:text-2xl">
            RUN YOUR OWN MISSION
          </h1>
          <p className="max-w-[680px] text-sm font-light leading-relaxed text-dim">
            The public explorer is free for any repo, forever. The software is MIT and self-hostable,
            forever. What costs money is the operation we run for you, and the one thing nobody can
            backfill later: your exact history, collected hour by hour from the day your mission starts.
          </p>
          <div className="hud max-w-[680px] px-4 py-3">
            <p className="numeral text-data leading-relaxed text-ink">
              THE DATA IS NEVER FOR SALE. Paying never moves a pixel of any chart: not yours, not
              anyone&apos;s. You buy operations and convenience, not position.
            </p>
          </div>
        </section>
      )}

      <section className="rise grid grid-cols-1 gap-3 md:grid-cols-3" style={{ animationDelay: "200ms" }}>
        {plans.map((p) => (
          <PlanCard key={p.name} p={p} />
        ))}
      </section>

      {/* the integrity contract: shown personalized too, where it reassures most */}
      {data ? (
        <section className="rise" style={{ animationDelay: "260ms" }}>
          <div className="hud px-4 py-3">
            <p className="numeral text-data leading-relaxed text-ink">
              THE DATA IS NEVER FOR SALE. Paying never moves a pixel of {repoName}&apos;s chart, or
              anyone&apos;s. You buy the operation and your own history, never position.
            </p>
          </div>
        </section>
      ) : null}

      <section className="rise flex flex-col gap-3" style={{ animationDelay: "300ms" }}>
        <h2 className="module-title">NOT A CUSTOMER, A PATRON?</h2>
        <p className="max-w-[680px] text-data font-light leading-relaxed text-dim">
          If you just want the public telemetry to stay free and independent, that path exists too:
          sponsorship funds the mission and buys exactly zero influence.
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
        <section className="rise flex flex-col gap-2" style={{ animationDelay: "360ms" }}>
          <h2 className="module-title">
            {data ? `THIS IS WHAT TRACKING ${repoName.toUpperCase()} LOOKS LIKE` : "SEE A LIVE HOSTED MISSION"}
          </h2>
          <Link href={`/r/${meta.repo}`} className="numeral text-data text-accent/90 hover:text-accent">
            {meta.repo} · a live console running on the exact Hosted Mission plan →
          </Link>
        </section>
      ) : null}

      <footer
        className="rise mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-grid pt-4"
        style={{ animationDelay: "420ms" }}
      >
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
