"use client";

import { useEffect, useMemo, useState } from "react";
import LiveProvider, { useLive } from "./LiveProvider";
import StatusBar from "./StatusBar";
import Panel from "./Panel";
import GalacticChart from "./GalacticChart";
import VelocityChart from "./VelocityChart";
import DailyLadder from "./DailyLadder";
import CumulativeChart from "./CumulativeChart";
import Projections from "./Projections";
import Heatmap from "./Heatmap";
import RankChart from "./RankChart";
import MissionLog from "./MissionLog";
import DailyBriefing from "./DailyBriefing";
import TargetHud from "./TargetHud";
import SoundController from "./SoundController";
import type { DashboardBundle } from "@/lib/bundle";
import type { ChartInputs } from "@/lib/types";
import { fmt } from "@/lib/format";

const TARGET_KEY = "mc_target";

function ChartIsland({
  bundle,
  target,
  onPinTarget,
}: {
  bundle: DashboardBundle;
  target: string | null;
  onPinTarget: (r: string | null) => void;
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
  return <GalacticChart inputs={inputs} target={target} onPinTarget={onPinTarget} />;
}

export default function Dashboard({ bundle }: { bundle: DashboardBundle }) {
  const repo = bundle.meta?.repo;
  const next = bundle.milestones[0] ?? null;
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    try {
      setTarget(localStorage.getItem(TARGET_KEY));
    } catch { /* private mode */ }
  }, []);

  const pinTarget = (r: string | null) => {
    setTarget(r);
    try {
      if (r) localStorage.setItem(TARGET_KEY, r);
      else localStorage.removeItem(TARGET_KEY);
    } catch { /* private mode */ }
  };

  return (
    <LiveProvider bundle={bundle}>
      <SoundController nextThreshold={next?.threshold ?? null} nextRank={next?.rank ?? null} />
      <main className="mx-auto flex max-w-[1440px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
        <StatusBar bundle={bundle} />
        <DailyBriefing bundle={bundle} />
        {target ? (
          <TargetHud bundle={bundle} target={target} onClear={() => pinTarget(null)} />
        ) : null}

        <Panel
          index="01"
          title="Star chart"
          meta={
            bundle.apex
              ? `destination: ${bundle.apex.r} · ${fmt(bundle.apex.s)} stars`
              : undefined
          }
          delay={80}
        >
          <ChartIsland bundle={bundle} target={target} onPinTarget={pinTarget} />
        </Panel>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Panel
            index="02"
            title="Velocity, stars per hour"
            meta="24h vs previous 24h"
            className="lg:col-span-8"
            delay={160}
          >
            <VelocityChart />
          </Panel>
          <Panel
            index="03"
            title="Milestone projections"
            meta={`own v7d ${fmt(Math.round(bundle.v7d))}/day`}
            className="lg:col-span-4"
            delay={240}
          >
            <Projections bundle={bundle} />
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel
            index="04"
            title="Daily ladder"
            meta="30 days · night floor 00-05 UTC"
            delay={320}
          >
            <DailyLadder bundle={bundle} />
          </Panel>
          <Panel
            index="05"
            title="Cumulative stars"
            meta={`since ${bundle.meta?.created_at?.slice(0, 10) ?? "launch"} · replay available`}
            delay={400}
          >
            <CumulativeChart bundle={bundle} />
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Panel
            index="06"
            title="Activity heatmap"
            meta={`${fmt(bundle.totalStars)} star events`}
            className="lg:col-span-7"
            delay={480}
          >
            <Heatmap bundle={bundle} />
          </Panel>
          <Panel
            index="07"
            title="World rank over time"
            meta="hourly snapshots"
            className="lg:col-span-5"
            delay={560}
          >
            <RankChart bundle={bundle} />
          </Panel>
        </div>

        <Panel
          index="08"
          title="Mission log"
          meta="auto-detected from telemetry"
          delay={640}
        >
          <MissionLog events={bundle.events} captain={bundle.captain} />
        </Panel>

        <footer className="rise flex flex-wrap items-center justify-between gap-2 px-1 pb-4 pt-2" style={{ animationDelay: "700ms" }}>
          <span className="numeral text-[9px] tracking-[0.15em] text-faint">
            MISSION CONTROL · open telemetry over public GitHub data
          </span>
          <span className="numeral text-[9px] text-faint">
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
