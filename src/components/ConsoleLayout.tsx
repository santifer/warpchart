// THE single source of truth for the mission console: panel order, grid,
// indices, titles and the free-shelf-first funnel. The house console
// (Dashboard), hosted tenants and the public scan (/r/ explorer) all render
// THIS layout and only differ in what fills each slot: full hourly data,
// instant public data, or a locked preview. Improve the layout here and
// every surface gets it at once (12-jun lesson: two JSX trees meant every
// improvement had to land twice, and sometimes only landed once).
// Pure JSX, no hooks: usable from client (Dashboard) and server (explorer).
import Panel from "./Panel";
import { PulsePanel, UsagePanel } from "./DossierPanels";
import type { Dossier } from "@/lib/explorer";
import type { ReactNode } from "react";

export interface ConsoleSlot {
  meta?: string;
  // optional header-right control (the race toggle on the cumulative panel)
  action?: ReactNode;
  node: ReactNode;
}

export default function ConsoleLayout({
  dossier,
  starChart,
  cumulative,
  velocity,
  projections,
  ladder,
  heatmap,
  rank,
  traffic,
  log,
  firstIndex = 2,
}: {
  dossier: Dossier | null;
  starChart: ConsoleSlot;
  cumulative: ConsoleSlot;
  velocity: ConsoleSlot;
  projections: ConsoleSlot;
  ladder: ConsoleSlot;
  heatmap: ConsoleSlot;
  rank: ConsoleSlot;
  traffic: ConsoleSlot;
  log: ConsoleSlot;
  // Panels are numbered in page order. Vital Signs (01) always sits above the
  // console and PR flow (02) only on repos that have it, so the caller says
  // where the console starts: 2 without PR flow, 3 with it. Hardcoded indices
  // used to give Vital Signs and the star chart the same "01".
  firstIndex?: number;
}) {
  const n = (k: number) => String(firstIndex + k).padStart(2, "0");
  return (
    <>
      <Panel index={n(0)} title="Star chart" meta={starChart.meta} delay={80}>
        {starChart.node}
      </Panel>

      {/* FREE SHELF: everything generated from public data sits right under
          the star chart (cumulative anchors the left column, the dossier
          stacks on the right); deeper panels follow once the visitor is in */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <Panel index={n(1)} title="Cumulative stars" meta={cumulative.meta} action={cumulative.action} delay={160}>
          {cumulative.node}
        </Panel>
        <div className="flex flex-col gap-4">
          <PulsePanel dossier={dossier} index={n(2)} delay={200} />
          {/* velocity moved here: it has room to spare in the narrow column */}
          <Panel index={n(3)} title="Velocity, stars per hour" meta={velocity.meta} delay={240}>
            {velocity.node}
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* real usage moved to the wide cell: it now stacks npm + clones over
            time and wants the horizontal room */}
        <UsagePanel dossier={dossier} index={n(4)} className="lg:col-span-8" delay={280} />
        <Panel
          index={n(5)}
          title="Milestone projections"
          meta={projections.meta}
          className="lg:col-span-4"
          delay={320}
        >
          {projections.node}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel index={n(6)} title="Daily ladder" meta={ladder.meta} delay={360}>
          {ladder.node}
        </Panel>
        <Panel index={n(7)} title="Activity heatmap" meta={heatmap.meta} delay={400}>
          {heatmap.node}
        </Panel>
      </div>

      <Panel index={n(8)} title="World rank over time" meta={rank.meta} delay={440}>
        {rank.node}
      </Panel>

      <Panel index={n(9)} title="Traffic vault" meta={traffic.meta} delay={480}>
        {traffic.node}
      </Panel>

      <Panel index={n(10)} title="Mission log" meta={log.meta} delay={520}>
        {log.node}
      </Panel>
    </>
  );
}
