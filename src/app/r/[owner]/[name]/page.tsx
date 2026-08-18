// Instant explorer: a live snapshot of any GitHub repo's position on the
// route to worldwide rank 1. ISR-cached per repo, so traffic never multiplies
// GitHub API cost.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ConsoleLayout from "@/components/ConsoleLayout";
import { RaceProvider, RaceToggle } from "@/components/RaceContext";
import GalacticChart from "@/components/GalacticChart";
import VerticalChart from "@/components/VerticalChart";
import LockedRankPreview from "@/components/LockedRankPreview";
import {
  VelocitySilhouette,
  HeatmapSilhouette,
  LadderSilhouette,
  LogSilhouette,
  StepsSilhouette,
} from "@/components/PanelSilhouettes";
import { repoRankTrajectory } from "@/lib/rank-history";
import GodRank from "@/components/GodRank";
import JsonLd, { repoGraph } from "@/components/JsonLd";
import Dashboard from "@/components/Dashboard";
import Badges from "@/components/Badges";
import CompareLab from "@/components/CompareLab";
import Masthead from "@/components/Masthead";
import { buildBundle } from "@/lib/bundle";
import { loadMeta, isHostedRepo, loadTenantHistory, loadTenantTimestamps, loadRoute } from "@/lib/history";
import { fetchLiveSnapshot } from "@/lib/live-blob";
import { isOwnedBy } from "@/lib/config";
import CodexModal from "@/components/CodexModal";
import ShareButton from "@/components/ShareButton";
import PinButton from "@/components/PinButton";
import FirstLightBanner from "@/components/FirstLightBanner";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import TrafficPanel from "@/components/TrafficPanel";
import VitalSignsPanel from "@/components/VitalSignsPanel";
import { loadVitals } from "@/lib/vitals";
import { getCachedCodex, listCodexes } from "@/lib/codex";
import { loadExplorerData, getCachedDossier } from "@/lib/explorer";
import { fmt, fmtCompact, fmtEtaDays } from "@/lib/format";
import { ghAvatar, ghAvatarForRepo } from "@/lib/avatar";

// Same template as the unlocked mission console: identical panels in identical
// order. The only difference between repos is what is unlocked. Locked
// panels render the REAL components fed with the live demo mission's data,
// dimmed and labeled, so visitors see exactly the telemetry they unlock.
// A quiet locked preview: the real component, dimmed, with ONE small tag.
// The conversion ask lives once, in the upsell band below, not shouted on
// every panel (six loud paywalls read as a wall, not a generous preview).
function Locked({ unlockFor, children }: { unlockFor: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="pointer-events-none select-none opacity-[0.28] blur-[2px]" aria-hidden>
        {children}
      </div>
      {/* the whole surface resolves to the personalized plan page (NOT straight
          to checkout): the visitor sees what THIS repo unlocks, priced for it,
          before any payment. A dead click on the blurred link-looking text
          would otherwise read as "the links are broken". */}
      <a
        href={`/pricing?repo=${encodeURIComponent(unlockFor)}`}
        className="absolute inset-0 z-10"
        aria-label={`See what tracking ${unlockFor} unlocks`}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="numeral border border-grid bg-void/70 px-2.5 py-1 text-micro tracking-[0.28em] text-faint">
          ◈ UNLOCK WITH TRACKING
        </span>
      </div>
    </div>
  );
}

// Regenerate the PAGE every 60s so tenant consoles pick up the fresh Vercel
// Blob snapshot near real-time. The expensive explorer GitHub calls stay on
// the 900s data cache (getCachedData above): this 60s only re-runs the render
// + a cheap edge-cached Blob read (null for non-tenants), no GitHub cost and
// no build.
export const revalidate = 60;
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
  const repo = `${owner}/${name}`;
  // pull the live-ish numbers from the cache-only route registry (no GitHub
  // call) so the meta description carries real facts, not a templated slug.
  // Falls back to the generic line for deep repos outside the top-1000 route.
  const route = loadRoute();
  const idx = route?.repos.findIndex((p) => p.r.toLowerCase() === repo.toLowerCase()) ?? -1;
  let description = `Worldwide star rank, velocity and the repos closing in on ${repo}. Live and free.`;
  if (idx >= 0 && route) {
    const p = route.repos[idx];
    const vel = Math.round(p.v7 ?? p.v ?? 0);
    // count above, not array index: the registry reorders once a day while the
    // star counts inside it refresh every 2 hours, so the index is last night's
    // position wearing this morning's stars (see the same fix in /api/og)
    const rank = route.repos.reduce((n, q) => (q.s > p.s ? n + 1 : n), 1);
    description =
      `${repo} ranks #${fmt(rank)} of every public GitHub repository — ${fmtCompact(p.s)} stars` +
      `${vel ? `, climbing ${fmt(vel)}/day` : ""}. Live worldwide rank, velocity and the repos closing in.`;
  }
  return {
    title: `${repo} · worldwide GitHub rank & velocity · Warpchart`,
    description,
    alternates: { canonical: `/r/${owner}/${name}` },
    openGraph: {
      title: `${repo} · Warpchart`,
      description,
      url: `/r/${owner}/${name}`,
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

  // charted frontier for the chart dots (solid = charted, hollow = uncharted),
  // shared by the unlocked dashboard branches and the public explorer below.
  const chartedRepos = (await listCodexes().catch(() => [])).map((c) => c.repo);

  // The tracked (unlocked) repo gets the FULL mission console on its own
  // /r/ route: same template as everyone, nothing locked. With paid
  // multi-tenant tracking this branch becomes "is tracking active for
  // this route" instead of "is it the tenant".
  const tenant = loadMeta();
  if (tenant && `${owner}/${name}`.toLowerCase() === tenant.repo.toLowerCase()) {
    const live = await fetchLiveSnapshot(tenant.repo);
    const tBundle = buildBundle(undefined, live);
    return (
      <>
        <JsonLd data={repoGraph(tenant.repo, { stars: tBundle.netStars, rank: tBundle.rank })} />
        <Dashboard
          bundle={tBundle}
          dossier={await getCachedDossier(owner, name)}
          vitals={await loadVitals(owner, name)}
          charted={chartedRepos}
        />
      </>
    );
  }

  // HOSTED MISSIONS + OWNER PORTFOLIO: paying repos AND every repo owned by a
  // privileged owner (santifer's whole portfolio) get the full console, fed by
  // their own collected history (same pipeline as the house repo). Live polling
  // stays off (the /api/live endpoints serve the house repo); the collector
  // cadence is the freshness contract. A repo whose first collection has not
  // landed yet falls through to the public explorer view until it does.
  const hostedLabel = `${owner}/${name}`;
  if (isHostedRepo(hostedLabel) || isOwnedBy(owner)) {
    const tHistory = loadTenantHistory(hostedLabel);
    const tTimestamps = loadTenantTimestamps(hostedLabel);
    const tLive = await fetchLiveSnapshot(hostedLabel);
    if (tHistory.length) {
      const tMeta = {
        repo: hostedLabel,
        owner,
        name,
        description: null,
        created_at: tTimestamps[0] ?? tHistory[0].ts,
        avatar_url: ghAvatar(owner),
        homepage: null,
        language: null,
        forks: 0,
      };
      const hBundle = buildBundle({ timestamps: tTimestamps, history: tHistory, meta: tMeta }, tLive);
      return (
        <>
          <JsonLd data={repoGraph(hostedLabel, { stars: hBundle.netStars, rank: hBundle.rank })} />
          <Dashboard
            bundle={hBundle}
            polling={false}
            dossier={await getCachedDossier(owner, name)}
            vitals={await loadVitals(owner, name)}
            charted={chartedRepos}
          />
        </>
      );
    }
  }

  // Shared cached snapshot (see loadExplorerData): resilient to degraded
  // refreshes and GitHub storms, and the SAME entry the /pricing?repo= page
  // reads. null = repository does not exist; transient errors rethrow -> 500
  // so the route never caches a false 404.
  const data = await loadExplorerData(owner, name);
  if (!data) notFound();

  const { inputs } = data;
  const next = inputs.milestones[0] ?? null;
  const repoLabel = `${owner}/${name}`;
  const repoName = name;

  // the dossier tagline shown inline (unique content up front, not hidden
  // behind the button) and the one-line verdict numbers
  const codex = await getCachedCodex(repoLabel).catch(() => null);
  const gap = next ? Math.max(0, next.threshold - inputs.stars) : null;
  const netV = next ? inputs.v7d - (next.drift ?? 0) : 0;
  const eta = next && gap !== null && gap > 0 && netV > 0 ? fmtEtaDays(gap / netV) : null;

  // the house tenant's repo NAME — only for the "see the live demo" links below.
  // We deliberately do NOT build its bundle: its data must never feed a
  // stranger's page, not even serialized into the RSC payload of a client island.
  const tenantRepo = loadMeta()?.repo ?? "";

  // does the moat already hold THIS repo's own world-rank trajectory? if so the
  // locked rank panel teases its real climb (the best "we already have your
  // data"); otherwise a neutral silhouette — never the house tenant's data.
  const hasOwnTraj = (await repoRankTrajectory(repoLabel).catch(() => [])).length >= 2;

  return (
    // NO ViewTransition here on purpose: the loading skeleton plays the
    // warp entrance, and the skeleton -> content reveal must be an in-place
    // swap (a second animated entrance made everything vanish and reappear)
    <main className="mx-auto flex max-w-[1440px] flex-col gap-4 px-2 py-4 sm:px-6 sm:py-6">
      <JsonLd data={repoGraph(repoLabel, { stars: inputs.stars, rank: inputs.rank })} />
      {/* same rich starfield as the landing/explore, so the translucent hud
          panels (and the star chart) float over space instead of flat dark */}
      <SpaceBackdrop mode="scan" />
      <div className="px-1">
        <Masthead />
      </div>
      {/* post-payment launch sequence: renders only with ?welcome=1 (gated
          client-side), and reveals the unlocked console once provisioning lands */}
      <FirstLightBanner repo={repoLabel} />
      {/* header */}
      <header className="hud px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="flex items-start gap-4 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ghAvatarForRepo(inputs.repo, 96)}
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 border border-grid"
            />
            <div className="min-w-0">
              <h1 className="font-display text-sm tracking-[0.18em] text-star uppercase truncate">
                {inputs.repo}
              </h1>
              <p className="mt-0.5 truncate text-sm font-light text-dim">
                {data.desc ?? "public repository"}
                {data.lang ? ` · ${data.lang}` : ""}
              </p>
              <Badges repo={repoLabel} className="mt-2" />
              {/* the dossier's own line, up front: unique content the visitor
                  reads before deciding to open the full transmission */}
              {codex?.tagline ? (
                <p className="mt-1.5 max-w-[54ch] text-sm font-light leading-snug text-accent">
                  {codex.tagline}
                </p>
              ) : null}
              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <CodexModal
                  repo={repoLabel}
                  stats={{ stars: inputs.stars, rank: inputs.rank, vPerDay: inputs.v7d }}
                />
                <ShareButton repo={repoLabel} stars={inputs.stars} rank={inputs.rank} vel={inputs.v7d} />
                <PinButton repo={repoLabel} />
                {!codex && (inputs.rank === null || inputs.rank > 500) ? (
                  <span className="numeral text-micro tracking-[0.15em] text-faint">
                    be the first to chart this system
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <div className="flex flex-col gap-1">
              <span className="module-title !text-micro">Stars</span>
              <span className="numeral glow-accent text-metric leading-none text-accent">
                {fmt(inputs.stars)}
              </span>
            </div>
            <div className="flex flex-col gap-1 border-l border-grid pl-5">
              <span className="module-title !text-micro">World rank</span>
              <span className="numeral text-metric leading-none text-ink">
                <span className="text-faint">#</span>
                {inputs.rank !== null ? fmt(inputs.rank) : "n/a"}
              </span>
            </div>
            <div className="flex flex-col gap-1 border-l border-grid pl-5">
              <span className="module-title !text-micro">Velocity</span>
              <span className="numeral text-metric leading-none text-ink">
                {fmt(Math.round(inputs.v7d))}<span className="text-sm text-dim">/day</span>
              </span>
            </div>
            {next && gap !== null && gap > 0 ? (
              <div className="flex flex-col gap-1 border-l border-grid pl-5">
                <span className="module-title !text-micro">Gap to top {next.rank}</span>
                <span className="numeral text-metric leading-none text-ink">
                  {fmt(gap)}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-grid pt-2.5">
          <p className="max-w-[62ch] text-sm font-light text-dim">
            {inputs.rank !== null ? (
              <>
                <span className="text-ink">{repoName}</span> sits{" "}
                <span className="text-accent">#{fmt(inputs.rank)}</span> of every public repository,
                climbing <span className="text-accent">{fmt(Math.round(inputs.v7d))}★/day</span>.
                {next && gap !== null && gap > 0 ? (
                  <>
                    {" "}
                    <span className="text-ink">{fmt(gap)}</span> more to break into the{" "}
                    <span className="text-accent">top {next.rank}</span>
                    {eta ? <span className="text-dim"> (~{eta})</span> : null}.
                  </>
                ) : null}
              </>
            ) : (
              <>
                Tracking <span className="text-ink">{inputs.repo}</span>, climbing{" "}
                <span className="text-accent">{fmt(Math.round(inputs.v7d))}★/day</span>.
              </>
            )}
          </p>
          <span className="numeral shrink-0 text-micro text-faint">
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

      {/* VITAL SIGNS: the derived-intelligence verdict (ALIVE vs MONUMENT), full
          width above the console. Cache-only (collector-computed); null vitals
          renders the locked upsell. Free for owned repos, paid for the rest. */}
      <div className="mb-4">
        <VitalSignsPanel repo={repoLabel} name={repoName} vitals={await loadVitals(owner, name)} />
      </div>

      <RaceProvider repo={repoLabel}>
        <ConsoleLayout
          dossier={data.dossier}
          starChart={{
            meta: inputs.apex
              ? `destination: ${inputs.apex.r} · ${fmt(inputs.apex.s)} stars`
              : undefined,
            node: (
              <>
                <div className="mb-2 hidden items-center justify-end gap-2 lg:flex">
                  <a
                    href={`/r/${tenantRepo}#deck`}
                    title="Fullscreen flight console. Unlocks with tracking; click to see it live on the demo mission."
                    className="numeral border border-grid px-2.5 py-1 text-micro tracking-[0.2em] text-faint transition-colors hover:border-accent/50 hover:text-accent"
                  >
                    ⛶ COMMAND DECK · ◈ LOCKED — SEE IT ON THE DEMO →
                  </a>
                </div>
                <div className="hidden landscape:block lg:block">
                  <GalacticChart inputs={inputs} liveLocals charted={chartedRepos} />
                </div>
                <div className="landscape:hidden lg:hidden">
                  <VerticalChart inputs={inputs} charted={chartedRepos} />
                </div>
              </>
            ),
          }}
          cumulative={{
            meta: "the race",
            action: <RaceToggle />,
            node: (
              <div className="flex h-full flex-col gap-2">
                {/* The star chart IS the race: CompareLab embedded starts as this
                    one repo and a threat-alert toggle injects its rivals.
                    /api/curve shares the cached reconstruction with the SVG embed,
                    so a page visit warms the embed for everyone. */}
                <div className="min-h-0 flex-1">
                  <CompareLab initialRepos={[repoLabel]} embedded />
                </div>
                <a
                  href={`/#embed=${encodeURIComponent(repoLabel)}`}
                  className="numeral self-start border border-accent/40 px-3 py-2 text-label tracking-[0.18em] text-accent transition-colors hover:bg-accent/10"
                >
                  GET THE ANIMATED README EMBED →
                </a>
              </div>
            ),
          }}
          velocity={{
            meta: "24h vs previous 24h",
            node: (
              <Locked unlockFor={repoLabel}>
                <VelocitySilhouette />
              </Locked>
            ),
          }}
          projections={{
            meta: "unlocks with tracking",
            node: (
              <Locked unlockFor={repoLabel}>
                <StepsSilhouette h={260} />
              </Locked>
            ),
          }}
          ladder={{
            meta: "unlocks with tracking",
            node: (
              <Locked unlockFor={repoLabel}>
                <LadderSilhouette />
              </Locked>
            ),
          }}
          heatmap={{
            meta: "unlocks with tracking",
            node: (
              <Locked unlockFor={repoLabel}>
                <HeatmapSilhouette />
              </Locked>
            ),
          }}
          rank={{
            meta: "unlocks with tracking",
            // owner-only god mode: with the private token in localStorage this
            // swaps the locked teaser for the repo's REAL world-rank trajectory
            // (the moat), client-side, so the public page keeps its ISR cache
            node: (
              <GodRank
                repo={repoLabel}
                locked={
                  hasOwnTraj ? (
                    // we already recorded THIS repo's world-rank: tease its real
                    // climb (the best "we already have your data"), never the
                    // house tenant's trajectory
                    <LockedRankPreview repo={repoLabel} name={repoName} />
                  ) : (
                    <Locked unlockFor={repoLabel}>
                      <StepsSilhouette />
                    </Locked>
                  )
                }
              />
            ),
          }}
          traffic={{
            meta: "private · unlocks with tracking",
            node: (
              <Locked unlockFor={repoLabel}>
                <TrafficPanel repo={repoLabel} />
              </Locked>
            ),
          }}
          log={{
            meta: "unlocks with tracking",
            node: (
              <Locked unlockFor={repoLabel}>
                <LogSilhouette />
              </Locked>
            ),
          }}
        />
        </RaceProvider>

      <div className="hud flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span className="numeral text-label text-dim">
          Full mission telemetry for {repoLabel}: hourly history, forensics, replay and
          projections, none of it backfillable later. See exactly what tracking{" "}
          {repoName} unlocks, and what it costs.
        </span>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/pricing?repo=${encodeURIComponent(repoLabel)}`}
            className="numeral border border-accent/50 bg-accent/10 px-3 py-1.5 text-label tracking-[0.2em] text-accent transition-colors hover:bg-accent/20"
          >
            CHART {name.toUpperCase().slice(0, 24)} →
          </a>
          <a
            href={`/r/${tenantRepo}#from=${encodeURIComponent(repoLabel)}`}
            className="numeral border border-grid px-3 py-1.5 text-label tracking-[0.2em] text-dim transition-colors hover:text-ink"
          >
            SEE THE LIVE DEMO MISSION
          </a>
          <a
            href="https://github.com/santifer/warpchart"
            target="_blank"
            rel="noopener noreferrer"
            className="numeral border border-grid px-3 py-1.5 text-label tracking-[0.2em] text-dim transition-colors hover:text-ink"
          >
            SELF-HOST FREE · 5 MIN
          </a>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 px-1 pb-4 pt-2">
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          WARPCHART · open telemetry over public GitHub data
        </span>
        <a
          href={`https://github.com/${inputs.repo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="numeral text-micro text-faint hover:text-dim"
        >
          github.com/{inputs.repo}
        </a>
      </footer>
    </main>
  );
}
