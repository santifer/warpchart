// Instant explorer: a live snapshot of any GitHub repo's position on the
// route to worldwide rank 1. ISR-cached per repo, so traffic never multiplies
// GitHub API cost.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GalacticChart from "@/components/GalacticChart";
import Panel from "@/components/Panel";
import { getExplorerData } from "@/lib/explorer";
import { fmt, fmtEtaDays, shortName } from "@/lib/format";
import { neighborEtas } from "@/lib/projections";

export const revalidate = 900;

const VALID = /^[\w.-]+$/;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; name: string }>;
}): Promise<Metadata> {
  const { owner, name } = await params;
  return {
    title: `${owner}/${name} · Mission Control`,
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
    data = await getExplorerData(owner, name);
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
            MISSION CONTROL // INSTANT SCAN
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
        <GalacticChart inputs={inputs} />
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
                href="https://github.com/santifer/mission-control"
                target="_blank"
                rel="noopener noreferrer"
                className="numeral border border-accent/40 px-3 py-2 text-center text-[11px] tracking-[0.2em] text-accent transition-colors hover:bg-accent/10"
              >
                DEPLOY YOUR OWN · 5 MIN
              </a>
              <a
                href="/"
                className="numeral border border-grid px-3 py-2 text-center text-[11px] tracking-[0.2em] text-dim transition-colors hover:text-ink"
              >
                SEE THE LIVE DEMO
              </a>
            </div>
          </div>
        </Panel>
      </div>

      <footer className="rise flex flex-wrap items-center justify-between gap-2 px-1 pb-4 pt-2">
        <span className="numeral text-[9px] tracking-[0.15em] text-faint">
          MISSION CONTROL · open telemetry over public GitHub data
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
