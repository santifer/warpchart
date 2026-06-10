"use client";

import LiveProvider from "./LiveProvider";
import StatusBar from "./StatusBar";
import Panel from "./Panel";
import GalacticChart from "./GalacticChart";
import VelocityChart from "./VelocityChart";
import DailyLadder from "./DailyLadder";
import CumulativeChart from "./CumulativeChart";
import Projections from "./Projections";
import Heatmap from "./Heatmap";
import RankChart from "./RankChart";
import type { DashboardBundle } from "@/lib/bundle";
import { fmt } from "@/lib/format";

export default function Dashboard({ bundle }: { bundle: DashboardBundle }) {
  const repo = bundle.meta?.repo;
  return (
    <LiveProvider bundle={bundle}>
      <main className="mx-auto flex max-w-[1440px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
        <StatusBar bundle={bundle} />

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
          <GalacticChart bundle={bundle} />
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
            meta={`since ${bundle.meta?.created_at?.slice(0, 10) ?? "launch"}`}
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

        <footer className="rise flex flex-wrap items-center justify-between gap-2 px-1 pb-4 pt-2" style={{ animationDelay: "640ms" }}>
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
