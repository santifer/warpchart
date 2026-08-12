// Mission plans. Two modes:
//   /pricing            -> the generic offer (free / pro / team / business)
//   /pricing?repo=o/n   -> the SAME offer, re-told around one repo: its live
//                          rank, velocity, the gap to its next gate, the repos
//                          hunting it, and what its hourly history is worth.
// The personalized page reads the exact cached snapshot the visitor just saw on
// /r/owner/name (loadExplorerData: shared cache, matching numbers, ~zero extra
// GitHub cost), so the plan feels measured for them, not pitched at them. The
// data is never for sale at any price; money buys operations.
//
// Conversion architecture (Claude x Gemini synthesis, jun-2026): lead with the
// loss frame (history can't be backfilled + GitHub erases traffic every 14
// days), prove it with a LIVE mission, anchor Team as the default, kill the
// objections with an FAQ, and keep the integrity contract loud.
import type { Metadata } from "next";
import Link from "next/link";
import { loadMeta } from "@/lib/history";
import { repoRankTrajectory } from "@/lib/rank-history";
import { loadExplorerData, type ExplorerData } from "@/lib/explorer";
import { fmt, fmtEtaDays } from "@/lib/format";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import JsonLd, { pricingGraph } from "@/components/JsonLd";
import LockedRankPreview from "@/components/LockedRankPreview";
import CompareLab from "@/components/CompareLab";
import { RaceProvider, RaceToggle } from "@/components/RaceContext";
import { ghAvatar } from "@/lib/avatar";

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
      // personalized ?repo= variants consolidate to the canonical /pricing so
      // we don't index an unbounded set of near-duplicate pricing URLs
      alternates: { canonical: "/pricing" },
      title: `Chart ${valid} · Warpchart`,
      description: `Track ${valid} with exact hourly history, world-rank trajectory, hunter ETAs and alerts. The public explorer stays free; your history is yours forever.`,
      openGraph: { images: [`/api/og?repo=${valid}`] },
    };
  }
  return {
    alternates: { canonical: "/pricing" },
    title: "Pricing · Warpchart",
    description:
      "Self-host Warpchart free, or get your repository tracked with exact hourly history, the traffic GitHub erases every 14 days, alerts and zero ops. The public explorer stays free forever; the data is never for sale.",
  };
}

const BUSINESS_MAILTO =
  "mailto:hi@warpchart.dev?subject=Warpchart%20Business&body=Repos%20to%20track%3A%0AOrg%3A%0A";

// ---- generic offer (no ?repo=) -------------------------------------------
const GENERIC_PLANS: Plan[] = [
  {
    name: "FREE",
    price: "$0",
    cadence: "forever",
    perks: [
      "The public explorer for any repo: live world rank, velocity, the race",
      "Self-host the full console — MIT, deploy in ~5 minutes",
      "Your collector, your GitHub quota, your data",
    ],
    cta: { label: "USE THE TEMPLATE →", href: "https://github.com/santifer/warpchart" },
    note: "Browse anything, or run it yourself.",
  },
  {
    name: "PRO",
    price: "$29",
    cadence: "/ month",
    perks: [
      "Traffic Vault: the clones, views and referrers GitHub deletes every 14 days, kept forever (yours, never sold)",
      "Track up to 3 repos with exact hourly history, from the second you start",
      "Automatic alerts (email, Slack or webhook) on incoming hunters and gate crossings",
      "Live console + replay, and a per-repo RSS feed of every event",
      "Exact live counter on your README badge",
      "Zero ops, we run the collector for you",
    ],
    cta: { label: "START PRO →", href: "/api/checkout?plan=pro" },
    note: "For the solo maintainer.",
  },
  {
    name: "TEAM",
    price: "$149",
    cadence: "/ month",
    accent: true,
    tag: "MOST TEAMS START HERE",
    perks: [
      "Everything in Pro, across up to 10 repos",
      "3 seats — your whole fleet on one wall",
      "Slack & webhook alerts for the team",
      "Priority support",
    ],
    cta: { label: "START TEAM →", href: "/api/checkout?plan=team" },
    note: "The employer pays. Maintainers never do.",
  },
  {
    name: "BUSINESS",
    price: "$399",
    cadence: "/ month",
    perks: [
      "Everything in Team, across up to 30 repos",
      "SSO and centralized billing",
      "Your entire open-source portfolio on one wall",
      "A direct line for the features you need",
    ],
    cta: { label: "TALK TO US →", href: BUSINESS_MAILTO },
    note: "For OSS-heavy companies.",
  },
];

// ---- personalized offer (?repo=owner/name) --------------------------------
function personalizedPlans(d: NonNullable<ExplorerData>): Plan[] {
  const repoLabel = d.inputs.repo;
  const owner = repoLabel.split("/")[0] ?? repoLabel;
  const name = repoLabel.split("/")[1] ?? repoLabel;
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
    ? `Automatic alerts the moment a hunter closes in or ${name} breaks into the top ${fmt(next.rank)} (email, Slack or RSS)`
    : `Automatic alerts the moment a hunter closes in or ${name} crosses its next gate (email, Slack or RSS)`;

  return [
    {
      name: "FREE",
      price: "$0",
      cadence: "forever · MIT",
      perks: [
        `Run the full ${name} console yourself: chart, replay, the race`,
        "MIT template, deploy on your own Vercel in ~5 min",
        `Or just keep the free public snapshot of ${name} you see now`,
      ],
      cta: { label: "USE THE TEMPLATE →", href: "https://github.com/santifer/warpchart" },
      note: "DIY: you run the ops, forever free.",
    },
    {
      name: "PRO",
      price: "$29",
      cadence: "/ month",
      perks: [
        `Traffic Vault: ${name}'s clones, views and referrers, the data GitHub deletes every 14 days, kept forever`,
        `Exact hourly history of ${name} from the second you pay (it cannot be backfilled)`,
        `${name}'s full console unlocked: rank trajectory, daily ladder, heatmap, spike forensics`,
        huntersPerk,
        gatePerk,
        `Exact live star counter on ${name}'s README badge and embed`,
      ],
      cta: {
        label: `TRACK ${name.toUpperCase().slice(0, 16)} →`,
        href: `/api/checkout?repo=${encodeURIComponent(repoLabel)}&plan=pro`,
      },
      note: "Up to 3 repos · charting starts the second you pay.",
    },
    {
      name: "TEAM",
      price: "$149",
      cadence: "/ month",
      accent: true,
      tag: `RECOMMENDED FOR ${OWNER}`,
      perks: [
        `Everything in Pro, across up to 10 of ${owner}'s repos`,
        "3 seats — the whole fleet on one wall",
        "Slack & webhook alerts for the team",
        "Priority support",
      ],
      cta: {
        label: `TRACK ${OWNER}'S FLEET →`,
        href: `/api/checkout?repo=${encodeURIComponent(repoLabel)}&plan=team`,
      },
      note: "The employer pays. Maintainers never do.",
    },
    {
      name: "BUSINESS",
      price: "$399",
      cadence: "/ month",
      perks: [
        `Everything in Team, across up to 30 of ${owner}'s repos`,
        "SSO and centralized billing",
        "Your entire open-source portfolio, tracked",
        "A direct line for the features you need",
      ],
      cta: { label: "TALK TO US →", href: BUSINESS_MAILTO },
      note: "For OSS-heavy companies.",
    },
  ];
}

// The loss frame, made visual: GitHub's traffic data is a sawtooth that resets
// to zero every 14 days; the Vault is one continuous, accumulating line. The
// divergence sells itself.
function VaultDivergence() {
  // The SVG is stretched edge-to-edge (preserveAspectRatio="none"), which would
  // distort any geometry or text drawn inside it: the endpoint dot becomes an
  // ellipse and the monospace labels get smeared wide. So ONLY the lines live in
  // the SVG (with non-scaling strokes, so their width stays even at any aspect),
  // while the dot and every label are HTML overlays positioned by percentage —
  // immune to the horizontal stretch. Day gridlines sit at 25/50/75% so the
  // overlaid "day N" labels line up under them.
  return (
    <div className="relative w-full">
      <svg
        viewBox="0 0 560 132"
        preserveAspectRatio="none"
        className="h-[120px] w-full sm:h-[148px]"
        role="img"
        aria-label="GitHub erases your traffic data every 14 days; the Warpchart Vault keeps it"
      >
        <line x1="0" y1="104" x2="560" y2="104" stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {[140, 280, 420].map((x) => (
          <line key={x} x1={x} y1="18" x2={x} y2="104" stroke="var(--grid)" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />
        ))}
        {/* GitHub: rises then is wiped to zero every 14 days */}
        <path
          d="M 0 104 L 120 58 L 140 104 L 260 58 L 280 104 L 400 58 L 420 104 L 540 58 L 560 104"
          fill="none"
          stroke="var(--warn)"
          strokeWidth="1.6"
          strokeOpacity="0.85"
          vectorEffect="non-scaling-stroke"
        />
        {/* Warpchart Vault: one continuous, accumulating record */}
        <path
          d="M 0 104 C 170 96 300 60 556 24"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* round endpoint dot — kept perfectly circular as an HTML overlay */}
      <span
        className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
        style={{ left: "99%", top: "18%", boxShadow: "0 0 9px var(--accent)" }}
        aria-hidden
      />
      <span
        className="numeral pointer-events-none absolute text-micro tracking-[0.1em] text-warn"
        style={{ left: "1%", top: "6%" }}
      >
        GITHUB · wiped every 14 days
      </span>
      <span
        className="numeral pointer-events-none absolute text-micro tracking-[0.1em] text-accent"
        style={{ right: "1%", top: "30%" }}
      >
        WARPCHART VAULT · kept forever
      </span>
      {[
        { left: "25%", label: "day 14" },
        { left: "50%", label: "day 28" },
        { left: "75%", label: "day 42" },
      ].map((d) => (
        <span
          key={d.label}
          className="numeral pointer-events-none absolute bottom-0 -translate-x-1/2 text-micro text-faint"
          style={{ left: d.left }}
        >
          {d.label}
        </span>
      ))}
    </div>
  );
}

function PlanCard({ p, annual }: { p: Plan; annual: { price: string; href: string } | null }) {
  const external = p.cta.href.startsWith("http") || p.cta.href.startsWith("mailto");
  return (
    <div
      className={`hud relative flex flex-col gap-4 px-5 py-5 ${
        p.accent ? "border-accent/70 lg:-my-2 lg:py-7" : ""
      }`}
    >
      {p.tag ? (
        <div className="absolute -top-2.5 left-5 numeral border border-accent/60 bg-void px-2 py-0.5 text-micro tracking-[0.18em] text-accent">
          {p.tag}
        </div>
      ) : null}
      <div>
        <div className={`numeral text-label tracking-[0.25em] ${p.accent ? "text-accent" : "text-dim"}`}>
          {p.name}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="numeral text-2xl font-semibold text-ink">{p.price}</span>
          <span className="numeral text-micro tracking-[0.12em] text-faint">{p.cadence}</span>
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
      <div className="mt-auto flex flex-col gap-2 pt-1">
        <a
          href={p.cta.href}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
          className={`numeral border px-4 py-2.5 text-center text-label tracking-[0.18em] transition-colors ${
            p.accent
              ? "border-accent/70 bg-accent/10 text-accent hover:bg-accent/20"
              : "border-grid text-dim hover:border-accent/50 hover:text-accent"
          }`}
        >
          {p.cta.label}
        </a>
        {annual ? (
          <a
            href={annual.href}
            className="numeral text-center text-micro tracking-[0.14em] text-faint transition-colors hover:text-accent"
          >
            or {annual.price}, 2 months free →
          </a>
        ) : null}
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

const FAQ: { q: string; a: string }[] = [
  {
    q: "Can't I just self-host it for free?",
    a: "Yes — it is MIT and deploys in about five minutes. You run the collector, manage the GitHub quota and keep it alive. Hosted is the same product with zero ops, and it starts recording the second you click, not the day you finish a deploy.",
  },
  {
    q: "Why can't you backfill my history?",
    a: "GitHub caps how far back its API goes, and the public archives miss viral bursts. The hour-by-hour truth of how a repo grew only exists from the moment tracking starts. Every day you wait is gone for good.",
  },
  {
    q: "Do you sell my data, or move my position?",
    a: "Never. It is public GitHub data, never for sale, and paying never moves a single pixel of any chart — not yours, not anyone's. You buy the operation and your own record, never position.",
  },
  {
    q: "Can I cancel? Is the history mine?",
    a: "Cancel anytime. Every day you recorded is yours to export and keep — paying buys the operation, not a hostage.",
  },
  {
    q: "Who pays — me, or my employer?",
    a: "Team and Business are built for the company to pay. A maintainer should never pay out of pocket to track the repo they keep alive for their employer.",
  },
];

export default async function Pricing({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string }>;
}) {
  const { repo } = await searchParams;
  const data = await resolveRepo(repo);
  const meta = loadMeta();
  const demoRepo = meta?.repo ?? null;

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
  // whether we ALREADY have recorded rank-history for this repo (the moat): the
  // header must not say "uncharted" while LockedRankPreview below shows days on record.
  let charted = false;

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
    charted = (await repoRankTrajectory(repoLabel).catch(() => [])).length >= 2;
  }

  // The annual option only appears once the annual Polar products exist (env set),
  // so we never show an annual price that would silently fall back to a monthly
  // charge. Annual = 2 months free (monthly x 10).
  const annualEnabled = Boolean(
    process.env.POLAR_PRODUCT_PRO_ANNUAL && process.env.POLAR_PRODUCT_TEAM_ANNUAL,
  );
  const repoQ = repoLabel ? `repo=${encodeURIComponent(repoLabel)}&` : "";
  const annualFor = (planName: string): { price: string; href: string } | null => {
    if (!annualEnabled) return null;
    if (planName === "PRO") return { price: "$290 / year", href: `/api/checkout?${repoQ}plan=pro-annual` };
    if (planName === "TEAM") return { price: "$1,490 / year", href: `/api/checkout?${repoQ}plan=team-annual` };
    return null;
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-[1080px] flex-col gap-14 px-4 py-10 sm:px-6">
      <JsonLd data={pricingGraph} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map(({ q, a }) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        }}
      />
      <SpaceBackdrop mode="launch" />

      <header className="rise flex items-center justify-between" style={{ animationDelay: "0ms" }}>
        <Link href="/" className="font-display text-sm tracking-[0.3em] text-star hover:text-accent">
          WARPCHART
        </Link>
        {data ? (
          <Link href={`/r/${repoLabel}`} className="numeral text-micro tracking-[0.18em] text-dim hover:text-accent">
            ← {repoLabel}
          </Link>
        ) : (
          <span className="numeral text-micro tracking-[0.2em] text-dim">MISSION PLANS</span>
        )}
      </header>

      {/* ===== HERO: the loss frame, up front ===== */}
      {data ? (
        <section className="rise flex flex-col gap-5" style={{ animationDelay: "80ms" }}>
          <div className="flex items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ghAvatar(repoOwner, 96)}
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 shrink-0 border border-grid"
            />
            <div className="min-w-0">
              <span className="numeral inline-block border border-grid px-2 py-0.5 text-micro tracking-[0.28em] text-faint">
                {charted ? "◈ ALREADY ON THE MAP" : "◌ CURRENTLY UNCHARTED"}
              </span>
              <h1 className="mt-2 font-display text-xl leading-snug tracking-[0.07em] text-ink sm:text-2xl">
                {charted ? "UNLOCK" : "START"} {repoName.toUpperCase()}&apos;S{" "}
                {charted ? "FULL RECORD" : "PERMANENT RECORD"}
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

          <p className="max-w-[720px] text-data font-light leading-relaxed text-dim">
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
            . Right now that is a snapshot. The hour-by-hour record of how it got here, and where it is
            heading, <span className="text-ink">only exists from the moment you start charting it</span>.
          </p>
        </section>
      ) : (
        <section className="rise flex flex-col gap-5" style={{ animationDelay: "80ms" }}>
          <h1 className="font-display text-2xl leading-[1.15] tracking-[0.06em] text-star glow-star sm:text-[2.4rem]">
            OWN THE GROWTH RECORD
            <br className="hidden sm:block" /> YOU CAN&apos;T GET BACK.
          </h1>
          <p className="max-w-[720px] text-base font-light leading-relaxed text-dim">
            The public explorer is free for any repo, forever. The software is MIT and self-hostable,
            forever. What money buys is the operation we run for you and the{" "}
            <span className="text-ink">one thing nobody can backfill later</span>: your exact history,
            collected hour by hour from the day your mission starts.
          </p>
        </section>
      )}

      {/* ===== THE LOSS FRAME, made visual ===== */}
      <section className="rise flex flex-col gap-4" style={{ animationDelay: "130ms" }}>
        <div className="hud flex flex-col gap-4 border-accent/30 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="module-title">GITHUB IS ERASING YOUR EVIDENCE</h2>
            <span className="numeral text-micro tracking-[0.15em] text-faint">two clocks running against you</span>
          </div>
          <VaultDivergence />
          <p className="text-data font-light leading-relaxed text-dim">
            GitHub deletes your traffic — clones, views and referrers — <span className="text-warn">every 14 days</span>,
            and star history <span className="text-ink">cannot be backfilled</span>. The forensic truth about{" "}
            {data ? <span className="text-ink">{repoName}</span> : "your repo"} only exists from the day tracking starts.
            {weekly > 0 ? (
              <>
                {" "}
                <span className="text-ink">{repoName}</span> added{" "}
                <span className="text-accent">~{fmt(weekly)} stars</span> in the last 7 days alone — none of it on a
                record yet.
              </>
            ) : null}
          </p>
        </div>
      </section>

      {/* ===== LIVE PROOF: a real mission, animated, on the page ===== */}
      {demoRepo ? (
        <section className="rise flex flex-col gap-3" style={{ animationDelay: "170ms" }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="module-title">
              {data ? `THIS IS WHAT TRACKING ${repoName.toUpperCase()} LOOKS LIKE` : "A LIVE MISSION, RIGHT NOW"}
            </h2>
            <span className="numeral text-micro tracking-[0.15em] text-faint">no mockups · real data</span>
          </div>
          {/* the real race chart — starts in race mode, so the crossing lines
              ARE the proof of crossing-data intelligence; flip to SOLO is live */}
          <RaceProvider repo={demoRepo} initialRaceOn>
            <div className="hud flex flex-col gap-3 p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="numeral text-label tracking-[0.18em] text-dim">CUMULATIVE STARS · THE RACE</span>
                <RaceToggle />
              </div>
              <div className="h-[400px] sm:h-[460px]">
                <CompareLab initialRepos={[demoRepo]} embedded />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-grid/60 pt-3">
                <span className="text-data font-light text-dim">
                  <span className="text-ink">{demoRepo}</span> against the repos it is passing — a live console on the exact
                  Hosted plan.
                </span>
                <Link
                  href={`/r/${demoRepo}`}
                  className="numeral shrink-0 text-label tracking-[0.18em] text-accent hover:underline underline-offset-4"
                >
                  OPEN THE LIVE CONSOLE →
                </Link>
              </div>
            </div>
          </RaceProvider>
        </section>
      ) : null}

      {/* the locked treasure: the real rank-history we have already recorded
          for this repo (renders only when we have >= 2 days on record) */}
      {data ? (
        <section className="rise" style={{ animationDelay: "200ms" }}>
          <LockedRankPreview repo={repoLabel} name={repoName} />
        </section>
      ) : null}

      {/* ===== THE PLANS ===== */}
      <section className="rise flex flex-col gap-4" style={{ animationDelay: "230ms" }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-title tracking-[0.12em] text-ink">CHOOSE YOUR MISSION</h2>
          <span className="numeral text-micro tracking-[0.15em] text-faint">cancel anytime · your history stays yours</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-start">
          {plans.map((p) => (
            <PlanCard key={p.name} p={p} annual={annualFor(p.name)} />
          ))}
        </div>
      </section>

      {/* ===== INTEGRITY CONTRACT ===== */}
      <section className="rise" style={{ animationDelay: "270ms" }}>
        <div className="hud px-4 py-3 sm:px-5">
          <p className="numeral text-data leading-relaxed text-ink">
            THE DATA IS NEVER FOR SALE. Paying never moves a pixel of {data ? `${repoName}'s chart` : "any chart"}, or
            anyone&apos;s. You buy the operation and your own history — never position.
          </p>
        </div>
      </section>

      {/* ===== FAQ: kill the objections ===== */}
      <section className="rise flex flex-col gap-4" style={{ animationDelay: "300ms" }}>
        <h2 className="font-display text-title tracking-[0.12em] text-ink">STRAIGHT ANSWERS</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {FAQ.map((f) => (
            <div key={f.q} className="hud flex flex-col gap-1.5 px-4 py-3.5">
              <h3 className="numeral text-label tracking-[0.08em] text-accent">{f.q}</h3>
              <p className="text-data font-light leading-relaxed text-dim">{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== SOFT CONVERSION: the free badge ===== */}
      <section className="rise" style={{ animationDelay: "330ms" }}>
        <a
          href={data ? `/#embed=${encodeURIComponent(repoLabel)}` : "/#embed"}
          className="hud flex flex-wrap items-center justify-between gap-3 border-dashed px-4 py-3 transition-colors hover:border-accent/50"
        >
          <span className="text-data font-light leading-relaxed text-dim">
            Not ready to track? Put a <span className="text-ink">live stars + rank badge</span> on{" "}
            {data ? `${repoName}'s` : "your"} README, free, and decide later.
          </span>
          <span className="numeral shrink-0 text-label tracking-[0.18em] text-accent">GET THE FREE BADGE →</span>
        </a>
        <p className="mt-2 numeral text-micro tracking-[0.14em] text-faint">
          Or{" "}
          <Link href="/constellation" className="text-accent underline-offset-4 hover:underline">
            follow repos free in your Constellation
          </Link>{" "}
          and watch them move, no signup.
        </p>
      </section>

      {/* ===== PATRON: a separate funnel ===== */}
      <section className="rise flex flex-col gap-3" style={{ animationDelay: "360ms" }}>
        <h2 className="module-title">NOT A CUSTOMER, A PATRON?</h2>
        <p className="max-w-[700px] text-data font-light leading-relaxed text-dim">
          If you just want the public telemetry to stay free and independent, that path exists too:
          sponsorship funds the mission and buys exactly zero influence.
        </p>
        <a
          href="https://github.com/sponsors/santifer"
          target="_blank"
          rel="noopener noreferrer"
          className="hud flex max-w-[700px] items-center justify-center border-dashed px-4 py-3 transition-colors hover:border-accent/50"
        >
          <span className="numeral text-label tracking-[0.2em] text-accent">
            BECOME A MISSION PATRON · from $5/mo →
          </span>
        </a>
      </section>

      <footer
        className="rise mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-grid pt-4"
        style={{ animationDelay: "400ms" }}
      >
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          WARPCHART · open telemetry over public GitHub data
        </span>
        <Link href="/" className="numeral text-micro text-accent/80 hover:text-accent">
          ← EXPLORE
        </Link>
      </footer>
    </main>
  );
}
