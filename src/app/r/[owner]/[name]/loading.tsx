"use client";

// Skeleton mirror of the real explorer page: the SAME header, panel grid and
// approximate heights, with blurred pulsing chart shapes where data will land.
// Loading then resolves into content with no layout shift. The live scan log
// streams in the header's top-right corner (an absolute overlay, so its
// disappearance moves nothing).
import { useEffect, useState } from "react";

const STEPS = [
  "establishing telemetry link",
  "resolving system coordinates",
  "reading worldwide route registry (top 1000)",
  "measuring stargazer velocity (last 100 stars)",
  "scanning neighboring systems",
  "computing overtake vectors",
];

const SLOW_NOTE = "GitHub turbulence · retrying upstream";

function ScanLog() {
  const [visible, setVisible] = useState(1);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const step = setInterval(() => setVisible((v) => Math.min(v + 1, STEPS.length)), 950);
    const slowTimer = setTimeout(() => setSlow(true), 9000);
    return () => {
      clearInterval(step);
      clearTimeout(slowTimer);
    };
  }, []);
  // single line: a 3-line log collided with the metric labels at mid widths
  const current = STEPS[Math.min(visible, STEPS.length) - 1];
  return (
    <div className="numeral pointer-events-none absolute right-2 top-1.5 hidden max-w-[60%] truncate bg-void/80 px-2 py-0.5 text-right text-micro sm:block">
      {slow ? (
        <span className="text-warn">{SLOW_NOTE}</span>
      ) : (
        <span className="text-dim">
          {"> "}
          {current}
          <span className="text-faint"> · {visible}/{STEPS.length}</span>
        </span>
      )}
    </div>
  );
}

// A blurred pulsing block standing in for a chart: same silhouette language
// as the locked previews, so loading reads as "data materializing".
function Ghost({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div className="absolute inset-0 animate-pulse bg-gradient-to-t from-accent/10 via-accent/[0.04] to-transparent blur-[2px]" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-grid" />
    </div>
  );
}

function Bar({ w }: { w: string }) {
  return <div className={`h-3 animate-pulse bg-grid/80 ${w}`} />;
}

function PanelSkeleton({
  index,
  title,
  meta,
  className = "",
  delay = 0,
  children,
}: {
  index: string;
  title: string;
  meta?: string;
  className?: string;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <section className={`hud rise flex flex-col ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <header className="flex items-baseline justify-between gap-3 border-b border-grid px-4 py-2.5 sm:px-5">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="module-index shrink-0">{index} /</span>
          <h2 className="module-title truncate">{title}</h2>
        </div>
        {meta ? <div className="numeral hidden shrink-0 text-label text-dim sm:block">{meta}</div> : null}
      </header>
      <div className="flex-1 px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

function MetricSkeleton({ label, border = false }: { label: string; border?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${border ? "border-l border-grid pl-5" : ""}`}>
      <span className="module-title !text-micro">{label}</span>
      <div className="h-8 w-20 animate-pulse bg-grid/80" />
    </div>
  );
}

export default function ExplorerLoading() {
  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      {/* header: same geometry as the real one, scan log overlaid top-right */}
      <header className="hud rise relative px-4 py-4 sm:px-6 sm:py-5">
        <ScanLog />
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="h-11 w-11 shrink-0 animate-pulse border border-grid bg-grid/40" />
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="pulse-dot" />
                <Bar w="w-44" />
              </div>
              <Bar w="w-64" />
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <MetricSkeleton label="Stars" />
            <MetricSkeleton label="World rank" border />
            <MetricSkeleton label="Velocity" border />
            <MetricSkeleton label="Gap to next gate" border />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-grid pt-2">
          <span className="numeral text-micro tracking-[0.15em] text-faint">
            WARPCHART // INSTANT SCAN
          </span>
          <span className="numeral text-micro text-faint">live snapshot · refreshes every 15 min</span>
        </div>
      </header>

      <PanelSkeleton index="01" title="Star chart" meta="resolving local band…" delay={80}>
        <div className="hidden lg:block">
          <Ghost className="h-[430px]" />
        </div>
        <div className="lg:hidden">
          <Ghost className="h-[600px]" />
        </div>
      </PanelSkeleton>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <PanelSkeleton index="02" title="Velocity, stars per hour" meta="24h vs previous 24h" className="lg:col-span-8" delay={160}>
          <Ghost className="h-[260px]" />
        </PanelSkeleton>
        <PanelSkeleton index="03" title="Milestone projections" meta="unlocks with tracking" className="lg:col-span-4" delay={240}>
          <div className="flex h-[260px] flex-col justify-between py-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <Bar w="w-24" />
                <Bar w="w-32" />
              </div>
            ))}
          </div>
        </PanelSkeleton>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PanelSkeleton index="04" title="Daily ladder" meta="unlocks with tracking" delay={320}>
          <Ghost className="h-[300px]" />
        </PanelSkeleton>
        <PanelSkeleton index="05" title="Cumulative stars" meta="real data · interactive" delay={400}>
          <div className="flex flex-col gap-2">
            <Ghost className="h-[280px]" />
            <div className="h-9 w-72 animate-pulse self-start border border-grid bg-grid/30" />
          </div>
        </PanelSkeleton>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <PanelSkeleton index="06" title="Activity heatmap" meta="unlocks with tracking" className="lg:col-span-7" delay={480}>
          <Ghost className="h-[220px]" />
        </PanelSkeleton>
        <PanelSkeleton index="07" title="World rank over time" meta="unlocks with tracking" className="lg:col-span-5" delay={560}>
          <Ghost className="h-[220px]" />
        </PanelSkeleton>
      </div>

      <PanelSkeleton index="08" title="Mission log" meta="unlocks with tracking" delay={640}>
        <div className="flex flex-col gap-3 py-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Bar w="w-20" />
              <Bar w={i % 2 ? "w-2/3" : "w-1/2"} />
            </div>
          ))}
        </div>
      </PanelSkeleton>
    </main>
  );
}
