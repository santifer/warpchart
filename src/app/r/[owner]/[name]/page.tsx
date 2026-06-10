// Instant explorer: a live snapshot of any GitHub repo's position on the
// route to worldwide rank 1. ISR-cached per repo, so traffic never multiplies
// GitHub API cost.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GalacticChart from "@/components/GalacticChart";
import VerticalChart from "@/components/VerticalChart";
import Panel from "@/components/Panel";
import { unstable_cache } from "next/cache";
import { getExplorerData } from "@/lib/explorer";

// Shared data cache: even when the route renders dynamically, the GitHub
// round-trips are paid at most once per repo per 15 minutes.
const getCachedExplorerData = unstable_cache(
  async (owner: string, name: string) => getExplorerData(owner, name),
  ["explorer-data"],
  { revalidate: 900 }
);
import { fmt, fmtEtaDays, shortName } from "@/lib/format";
import { neighborEtas } from "@/lib/projections";

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
  const etas = neighborEtas(data.neighbors, inputs.stars, inputs.v7d)
    .filter((n) => n.gap > 0)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 10);
  const next = inputs.milestones[0] ?? null;

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel index="02" title="Nearest ships ahead" meta="closing speed vs their velocity" className="lg:col-span-8" delay={160}>
          {etas.length ? (
            <table className="numeral w-full text-[11px]">
              <thead>
                <tr className="text-left text-[9px] tracking-[0.2em] text-faint">
                  <th className="pb-2 font-normal">REPO</th>
                  <th className="pb-2 font-normal text-right">STARS</th>
                  <th className="pb-2 font-normal text-right">GAP</th>
                  <th className="pb-2 font-normal text-right">VELOCITY</th>
                  <th className="pb-2 font-normal text-right">OVERTAKE</th>
                </tr>
              </thead>
              <tbody>
                {etas.map((n) => (
                  <tr key={n.r} className="border-t border-grid/60">
                    <td className="py-1.5 text-ink">{shortName(n.r)}</td>
                    <td className="py-1.5 text-right text-dim">{fmt(n.s)}</td>
                    <td className="py-1.5 text-right text-dim">+{fmt(n.gap)}</td>
                    <td className="py-1.5 text-right text-dim">{Math.round(n.v)}/d</td>
                    <td className={`py-1.5 text-right ${n.receding ? "text-warn" : "text-accent"}`}>
                      {n.receding ? "receding" : fmtEtaDays(n.etaDays)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="numeral text-[10px] text-faint">no ships ahead in telemetry range.</p>
          )}
        </Panel>

        <Panel index="03" title="Track it properly" className="lg:col-span-4" delay={240}>
          <div className="flex h-full flex-col justify-between gap-4">
            <p className="text-xs font-light leading-relaxed text-dim">
              This is a live snapshot. A full mission control adds hourly history,
              velocity charts, milestone projections, activity heatmap, replay and
              a mission log for your own repo.
            </p>
            <div className="flex flex-col gap-2">
              <a
                href={`/explore#embed=${encodeURIComponent(`${owner}/${name}`)}`}
                className="numeral border border-accent/40 px-3 py-2 text-center text-[11px] tracking-[0.2em] text-accent transition-colors hover:bg-accent/10"
              >
                EMBED THIS ANIMATED CHART →
              </a>
              <a
                href="https://github.com/santifer/warpchart"
                target="_blank"
                rel="noopener noreferrer"
                className="numeral border border-grid px-3 py-2 text-center text-[11px] tracking-[0.2em] text-dim transition-colors hover:text-ink"
              >
                DEPLOY YOUR OWN · 5 MIN
              </a>
              <a
                href="/hq"
                className="numeral border border-grid px-3 py-2 text-center text-[11px] tracking-[0.2em] text-dim transition-colors hover:text-ink"
              >
                SEE A FULL MISSION LIVE
              </a>
            </div>
          </div>
        </Panel>
      </div>

      <Panel index="04" title="Star history · animated" meta="the same SVG you can embed" delay={320}>
        <div className="flex flex-col gap-2">
          {/* same resource as the README embed: rendering it here warms the
              cache for everyone who embeds this repo afterwards */}
          <a href={`/explore#embed=${encodeURIComponent(`${owner}/${name}`)}`} className="block min-h-[180px]">
            <picture>
              <source
                media="(prefers-color-scheme: dark)"
                srcSet={`/api/chart?repo=${encodeURIComponent(`${owner}/${name}`)}&theme=dark`}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/chart?repo=${encodeURIComponent(`${owner}/${name}`)}&theme=light`}
                alt={`Animated cumulative star history of ${owner}/${name}. First render of a new repo can take a few seconds.`}
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

      <Panel index="05" title="Full mission telemetry" meta="preview · not live data" delay={400}>
        <div className="relative">
          {/* honest skeletons: wireframes, never fake numbers */}
          <div className="grid grid-cols-2 gap-3 opacity-60 blur-[1.5px] sm:grid-cols-3" aria-hidden>
            {[
              { t: "VELOCITY / HOUR", bars: [38, 62, 45, 80, 55, 70, 92, 60] },
              { t: "DAILY LADDER", bars: [70, 55, 85, 40, 65, 90, 50, 75] },
              { t: "ACTIVITY HEATMAP", bars: [30, 45, 60, 75, 50, 65, 40, 55] },
              { t: "RANK OVER TIME", bars: [85, 78, 72, 66, 58, 50, 40, 28] },
              { t: "REPLAY · DAY ZERO", bars: [10, 18, 30, 38, 52, 64, 78, 95] },
              { t: "MISSION LOG", bars: [50, 50, 50, 50, 50, 50, 50, 50] },
            ].map((p) => (
              <div key={p.t} className="hud px-3 py-2.5">
                <div className="module-title !text-[8px]">{p.t}</div>
                <div className="mt-2 flex h-12 items-end gap-1">
                  {p.bars.map((b, i) => (
                    <div key={i} className="w-full bg-grid" style={{ height: `${b}%` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <span className="numeral text-[10px] tracking-[0.35em] text-dim">◈ LOCKED</span>
            <p className="max-w-[460px] text-xs font-light leading-relaxed text-ink">
              Hourly history, velocity, projections, heatmap, spike forensics, replay and a
              mission log, continuously tracked for {owner}/{name}.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <a
                href="https://github.com/santifer/warpchart/issues/8"
                target="_blank"
                rel="noopener noreferrer"
                className="numeral border border-accent/50 bg-accent/10 px-4 py-2 text-[11px] tracking-[0.2em] text-accent transition-colors hover:bg-accent/20"
              >
                JOIN THE WAITLIST →
              </a>
              <a
                href={`/hq#from=${encodeURIComponent(`${owner}/${name}`)}`}
                className="numeral border border-grid px-4 py-2 text-[11px] tracking-[0.2em] text-dim transition-colors hover:text-ink"
              >
                SEE IT LIVE ON THE DEMO MISSION
              </a>
            </div>
            <span className="numeral text-[9px] text-faint">
              self-hosting your own is free forever · the demo marks where {name} sits on its map
            </span>
          </div>
        </div>
      </Panel>

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
