// Instant explorer: a live snapshot of any GitHub repo's position on the
// route to worldwide rank 1. ISR-cached per repo, so traffic never multiplies
// GitHub API cost.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GalacticChart from "@/components/GalacticChart";
import VerticalChart from "@/components/VerticalChart";
import Panel from "@/components/Panel";
import LiveProvider from "@/components/LiveProvider";
import VelocityChart from "@/components/VelocityChart";
import Projections from "@/components/Projections";
import DailyLadder from "@/components/DailyLadder";
import Heatmap from "@/components/Heatmap";
import RankChart from "@/components/RankChart";
import MissionLog from "@/components/MissionLog";
import Dashboard from "@/components/Dashboard";
import { buildBundle } from "@/lib/bundle";
import { loadMeta } from "@/lib/history";
import { unstable_cache } from "next/cache";
import { getExplorerData } from "@/lib/explorer";

// Shared data cache: even when the route renders dynamically, the GitHub
// round-trips are paid at most once per repo per 15 minutes.
const getCachedExplorerData = unstable_cache(
  async (owner: string, name: string) => getExplorerData(owner, name),
  ["explorer-data"],
  { revalidate: 900 }
);
import { fmt } from "@/lib/format";

// Same template as the unlocked mission console: identical panels in identical
// order. The only difference between repos is what is unlocked. Locked
// panels render the REAL components fed with the live demo mission's data,
// dimmed and labeled, so visitors see exactly the telemetry they unlock.
function Locked({ unlockFor, children }: { unlockFor: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="pointer-events-none select-none opacity-40 blur-[1.5px]" aria-hidden>
        {children}
      </div>
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-center">
        <span className="numeral bg-void/75 px-3 py-1 text-[9px] tracking-[0.3em] text-dim">
          ◈ LOCKED · PREVIEW SHOWS THE LIVE DEMO MISSION
        </span>
        <a
          href="https://github.com/santifer/warpchart/issues/8"
          target="_blank"
          rel="noopener noreferrer"
          className="numeral border border-accent/50 bg-void/85 px-3 py-1.5 text-[10px] tracking-[0.2em] text-accent transition-colors hover:bg-accent/10"
        >
          UNLOCK FOR {unlockFor} →
        </a>
      </div>
    </div>
  );
}

export const revalidate = 900;
// First scans make several GitHub round-trips; on flaky days the retries can
// exceed the default serverless budget, which surfaced as recurring 500s.
export const maxDuration = 60;

const VALID = /^[\w.-]+$/;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; name: string }>;
}): Promise<Metadata> {
  const { owner, name } = await params;
  return {
    title: `${owner}/${name} · Warpchart`,
    description: `Worldwide star rank, velocity and ranking neighbors of ${owner}/${name}.`,
    openGraph: {
      images: [`/api/og?repo=${owner}/${name}`],
    },
  };
}

export default async function ExplorerPage({
  params,
}: {
  params: Promise<{ owner: string; name: string }>;
}) {
  const { owner, name } = await params;
  if (!VALID.test(owner) || !VALID.test(name)) notFound();

  // The tracked (unlocked) repo gets the FULL mission console on its own
  // /r/ route: same template as everyone, nothing locked. With paid
  // multi-tenant tracking this branch becomes "is tracking active for
  // this route" instead of "is it the tenant".
  const tenant = loadMeta();
  if (tenant && `${owner}/${name}`.toLowerCase() === tenant.repo.toLowerCase()) {
    return <Dashboard bundle={buildBundle()} />;
  }

  let data;
  try {
    data = await getCachedExplorerData(owner, name);
  } catch (err) {
    // A real "repository not found" caches as 404; transient GitHub errors
    // must NOT (rethrow -> 500, the next visitor triggers a fresh attempt).
    if (err instanceof Error && /not[ _]?found|could not resolve/i.test(err.message)) {
      notFound();
    }
    console.error(`[explorer] ${owner}/${name} failed:`, err);
    throw err;
  }
  if (!data) notFound();

  const { inputs } = data;
  const next = inputs.milestones[0] ?? null;
  const repoLabel = `${owner}/${name}`;

  // Demo data for the locked panels: the live mission's bundle, slimmed
  // (no route layers, sparser replay buckets) to keep the page light.
  const demo = buildBundle();
  const demoBundle = {
    ...demo,
    routeAll: [],
    routeDots: [],
    routeLandmarks: [],
    hourlyAll: demo.hourlyAll.filter((_, i) => i % 4 === 0),
  };

  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      {/* header */}
      <header className="hud rise px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div className="flex items-center gap-4 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://github.com/${inputs.repo.split("/")[0]}.png?size=96`}
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 border border-grid"
            />
            <div className="min-w-0">
              <h1 className="font-display text-sm tracking-[0.18em] text-star uppercase truncate">
                {inputs.repo}
              </h1>
              <p className="mt-0.5 truncate text-xs font-light text-dim">
                {data.desc ?? "public repository"}
                {data.lang ? ` · ${data.lang}` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <div className="flex flex-col gap-1">
              <span className="module-title !text-[9px]">Stars</span>
              <span className="numeral glow-accent text-2xl leading-none text-accent">
                {fmt(inputs.stars)}
              </span>
            </div>
            <div className="flex flex-col gap-1 border-l border-grid pl-5">
              <span className="module-title !text-[9px]">World rank</span>
              <span className="numeral text-2xl leading-none text-ink">
                <span className="text-faint">#</span>
                {inputs.rank !== null ? fmt(inputs.rank) : "n/a"}
              </span>
            </div>
            <div className="flex flex-col gap-1 border-l border-grid pl-5">
              <span className="module-title !text-[9px]">Velocity</span>
              <span className="numeral text-2xl leading-none text-ink">
                {fmt(Math.round(inputs.v7d))}<span className="text-xs text-dim">/day</span>
              </span>
            </div>
            {next ? (
              <div className="flex flex-col gap-1 border-l border-grid pl-5">
                <span className="module-title !text-[9px]">Gap to top {next.rank}</span>
                <span className="numeral text-2xl leading-none text-ink">
                  {fmt(Math.max(0, next.threshold - inputs.stars))}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-grid pt-2">
          <span className="numeral text-[9px] tracking-[0.15em] text-faint">
            WARPCHART // INSTANT SCAN
          </span>
          <span className="numeral text-[9px] text-faint">
            {data.forkRatio !== null ? (
              <>
                fork ratio {(data.forkRatio * 100).toFixed(1)}%
                {data.forkPercentile !== null
                  ? ` (higher than ${data.forkPercentile}% of the top 1000)`
                  : ""}
                {" · "}
              </>
            ) : null}
            {data.degraded ? "velocity telemetry degraded, next refresh retries · " : ""}
            live snapshot · refreshes every 15 min
          </span>
        </div>
      </header>

      <Panel
        index="01"
        title="Star chart"
        meta={inputs.apex ? `destination: ${inputs.apex.r} · ${fmt(inputs.apex.s)} stars` : undefined}
        delay={80}
      >
        <div className="hidden lg:block">
          <GalacticChart inputs={inputs} />
        </div>
        <div className="lg:hidden">
          <VerticalChart inputs={inputs} />
        </div>
      </Panel>

      <LiveProvider bundle={demoBundle} polling={false}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Panel index="02" title="Velocity, stars per hour" meta="24h vs previous 24h" className="lg:col-span-8" delay={160}>
            <Locked unlockFor={repoLabel}>
              <VelocityChart />
            </Locked>
          </Panel>
          <Panel index="03" title="Milestone projections" meta="unlocks with tracking" className="lg:col-span-4" delay={240}>
            <Locked unlockFor={repoLabel}>
              <Projections bundle={demoBundle} />
            </Locked>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel index="04" title="Daily ladder" meta="unlocks with tracking" delay={320}>
            <Locked unlockFor={repoLabel}>
              <DailyLadder bundle={demoBundle} />
            </Locked>
          </Panel>
          <Panel index="05" title="Cumulative stars" meta="real data · the same SVG you can embed" delay={400}>
            <div className="flex flex-col gap-2">
              {/* same resource as the README embed: rendering it here warms
                  the cache for everyone who embeds this repo afterwards */}
              <a href={`/explore#embed=${encodeURIComponent(repoLabel)}`} className="block min-h-[160px]">
                <picture>
                  <source
                    media="(prefers-color-scheme: dark)"
                    srcSet={`/api/chart?repo=${encodeURIComponent(repoLabel)}&theme=dark`}
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/chart?repo=${encodeURIComponent(repoLabel)}&theme=light`}
                    alt={`Animated cumulative star history of ${repoLabel}. First render of a new repo can take a few seconds.`}
                    className="w-full"
                    loading="lazy"
                  />
                </picture>
              </a>
              <span className="numeral text-[9px] text-faint">
                first scan of a repo can take ~20s · click the chart to grab the README embed
              </span>
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Panel index="06" title="Activity heatmap" meta="unlocks with tracking" className="lg:col-span-7" delay={480}>
            <Locked unlockFor={repoLabel}>
              <Heatmap bundle={demoBundle} />
            </Locked>
          </Panel>
          <Panel index="07" title="World rank over time" meta="unlocks with tracking" className="lg:col-span-5" delay={560}>
            <Locked unlockFor={repoLabel}>
              <RankChart bundle={demoBundle} />
            </Locked>
          </Panel>
        </div>

        <Panel index="08" title="Mission log" meta="unlocks with tracking" delay={640}>
          <Locked unlockFor={repoLabel}>
            <MissionLog events={demoBundle.events.slice(0, 8)} captain={demoBundle.captain} />
          </Locked>
        </Panel>
      </LiveProvider>

      <div className="hud flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span className="numeral text-[10px] text-dim">
          Full mission telemetry for {repoLabel}: hourly history, forensics, replay and projections.
        </span>
        <div className="flex flex-wrap gap-2">
          <a
            href="https://github.com/santifer/warpchart/issues/8"
            target="_blank"
            rel="noopener noreferrer"
            className="numeral border border-accent/50 bg-accent/10 px-3 py-1.5 text-[10px] tracking-[0.2em] text-accent transition-colors hover:bg-accent/20"
          >
            JOIN THE WAITLIST →
          </a>
          <a
            href={`/r/${demo.meta?.repo ?? ""}#from=${encodeURIComponent(repoLabel)}`}
            className="numeral border border-grid px-3 py-1.5 text-[10px] tracking-[0.2em] text-dim transition-colors hover:text-ink"
          >
            SEE THE LIVE DEMO MISSION
          </a>
          <a
            href="https://github.com/santifer/warpchart"
            target="_blank"
            rel="noopener noreferrer"
            className="numeral border border-grid px-3 py-1.5 text-[10px] tracking-[0.2em] text-dim transition-colors hover:text-ink"
          >
            SELF-HOST FREE · 5 MIN
          </a>
        </div>
      </div>

      <footer className="rise flex flex-wrap items-center justify-between gap-2 px-1 pb-4 pt-2">
        <span className="numeral text-[9px] tracking-[0.15em] text-faint">
          WARPCHART · open telemetry over public GitHub data
        </span>
        <a
          href={`https://github.com/${inputs.repo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="numeral text-[9px] text-faint hover:text-dim"
        >
          github.com/{inputs.repo}
        </a>
      </footer>
    </main>
  );
}
