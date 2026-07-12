"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LiveProvider, { useLive } from "./LiveProvider";
import StatusBar from "./StatusBar";
import Masthead from "./Masthead";
import SpaceBackdrop from "./SpaceBackdrop";
import ConsoleLayout from "./ConsoleLayout";
import { RaceProvider, RaceToggle } from "./RaceContext";
import type { Dossier } from "@/lib/explorer";
import GalacticChart from "./GalacticChart";
import VerticalChart from "./VerticalChart";
import CommandDeck from "./CommandDeck";
import VelocityChart from "./VelocityChart";
import DailyLadder from "./DailyLadder";
import CompareLab from "./CompareLab";
import Projections from "./Projections";
import Heatmap from "./Heatmap";
import RankChart from "./RankChart";
import MissionLog from "./MissionLog";
import TrafficPanel from "./TrafficPanel";
import VitalSignsPanel from "./VitalSignsPanel";
import type { Vitals } from "@/lib/vitals";
import DailyBriefing from "./DailyBriefing";
import TargetHud from "./TargetHud";
import SoundController from "./SoundController";
import StarFall from "./StarFall";
import CapabilitiesBand from "./CapabilitiesBand";
import type { DashboardBundle } from "@/lib/bundle";
import type { ChartInputs } from "@/lib/types";
import { fmt } from "@/lib/format";

const TARGET_KEY = "mc_target";

function ChartIsland({
  bundle,
  target,
  onPinTarget,
  charted,
}: {
  bundle: DashboardBundle;
  target: string | null;
  onPinTarget: (r: string | null) => void;
  charted?: string[];
}) {
  const live = useLive();
  const inputs = useMemo<ChartInputs>(
    () => ({
      repo: bundle.meta?.repo ?? "unknown/unknown",
      stars: live.stars,
      rank: live.rank,
      v7d: bundle.v7d,
      neighbors: live.neighbors,
      milestones: bundle.milestones,
      apex: bundle.apex,
      routeDots: bundle.routeDots,
      routeLandmarks: bundle.routeLandmarks,
      routeAll: bundle.routeAll,
      nowMs: live.nowMs,
    }),
    [bundle, live.stars, live.rank, live.neighbors, live.nowMs]
  );
  return (
    <>
      <div className="hidden landscape:block lg:block">
        <GalacticChart inputs={inputs} target={target} onPinTarget={onPinTarget} charted={charted} />
      </div>
      <div className="landscape:hidden lg:hidden">
        <VerticalChart inputs={inputs} target={target} onPinTarget={onPinTarget} charted={charted} />
      </div>
    </>
  );
}

// polling=false for hosted tenants: the /api/live endpoints serve the house
// repo, so a tenant console refreshes on the collector cadence instead.
export default function Dashboard({
  bundle,
  polling = true,
  dossier = null,
  vitals = null,
  charted,
}: {
  bundle: DashboardBundle;
  polling?: boolean;
  dossier?: Dossier | null;
  vitals?: Vitals | null;
  charted?: string[];
}) {
  const repo = bundle.meta?.repo;
  const next = bundle.milestones[0] ?? null;
  const [target, setTarget] = useState<string | null>(null);
  const [deck, setDeck] = useState(false);

  // mount-only hydration from browser-only state (saved target + deck deep
  // link); server and first client render agree (no target, no deck), so there
  // is no hydration mismatch.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTarget(localStorage.getItem(TARGET_KEY));
    } catch { /* private mode */ }
    // deep link from locked explorer pages: see the deck live on the demo
    if (window.location.hash.includes("deck")) setDeck(true);
  }, []);

  const pinTarget = (r: string | null) => {
    setTarget(r);
    try {
      if (r) localStorage.setItem(TARGET_KEY, r);
      else localStorage.removeItem(TARGET_KEY);
    } catch { /* private mode */ }
  };

  return (
    <LiveProvider bundle={bundle} polling={polling}>
      <SoundController nextThreshold={next?.threshold ?? null} nextRank={next?.rank ?? null} />
      <StarFall />
      <main className="mx-auto flex max-w-[1440px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
        <SpaceBackdrop mode="scan" />
        <div className="px-1">
          <Masthead />
        </div>
        <StatusBar bundle={bundle} />
        <DailyBriefing bundle={bundle} />
        <VitalSignsPanel repo={repo ?? ""} name={repo?.split("/")[1] ?? ""} vitals={vitals} />
        {target ? (
          <TargetHud bundle={bundle} target={target} onClear={() => pinTarget(null)} />
        ) : null}

        {deck ? (
          <CommandDeck
            bundle={bundle}
            dossier={dossier}
            target={target}
            onPinTarget={pinTarget}
            onExit={() => setDeck(false)}
          />
        ) : null}

        <RaceProvider repo={repo ?? ""}>
        <ConsoleLayout
          dossier={dossier}
          starChart={{
            meta: bundle.apex
              ? `destination: ${bundle.apex.r} · ${fmt(bundle.apex.s)} stars`
              : undefined,
            node: (
              <>
                <div className="mb-2 hidden justify-end lg:flex">
                  <button
                    onClick={() => setDeck(true)}
                    className="numeral border border-grid px-2.5 py-1 text-micro tracking-[0.2em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
                  >
                    ⛶ COMMAND DECK
                  </button>
                </div>
                <ChartIsland bundle={bundle} target={target} onPinTarget={pinTarget} charted={charted} />
              </>
            ),
          }}
          cumulative={{
            meta: "the race",
            action: <RaceToggle />,
            node: <CompareLab initialRepos={[repo ?? ""]} embedded />,
          }}
          velocity={{ meta: "24h vs previous 24h", node: <VelocityChart /> }}
          projections={{
            meta: `own v7d ${fmt(Math.round(bundle.v7d))}/day`,
            node: <Projections bundle={bundle} />,
          }}
          ladder={{ meta: "full history · drag to pan · night floor 00-05 UTC", node: <DailyLadder bundle={bundle} /> }}
          heatmap={{ meta: `${fmt(bundle.totalStars)} star events`, node: <Heatmap bundle={bundle} /> }}
          rank={{ meta: "hourly snapshots", node: <RankChart bundle={bundle} /> }}
          traffic={{
            meta: "private · kept past GitHub's 14-day window",
            node: <TrafficPanel repo={repo ?? ""} />,
          }}
          log={{
            meta: "auto-detected from telemetry",
            node: <MissionLog events={bundle.events} captain={bundle.captain} />,
          }}
        />
        </RaceProvider>

        <CapabilitiesBand />

        <footer className="flex flex-wrap items-center justify-between gap-2 px-1 pb-4 pt-2">
          <span className="numeral text-micro tracking-[0.15em] text-faint">
            WARPCHART · open telemetry over public GitHub data
          </span>
          <Link
            prefetch={false}
            href="/"
            className="numeral text-micro tracking-[0.15em] text-accent/80 transition-colors hover:text-accent"
          >
            EXPLORE ANY REPO →
          </Link>
          <span className="numeral text-micro text-faint">
            {repo ? (
              <a
                href={`https://github.com/${repo}`}
                className="hover:text-dim"
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/{repo}
              </a>
            ) : null}
          </span>
        </footer>
      </main>
    </LiveProvider>
  );
}
