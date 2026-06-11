"use client";

// Skeleton mirror of the real explorer page. The star chart band is ALIVE
// from the first paint (twinkling starfield + route timeline), the scan log
// streams in the header's right side (metrics appear only when real), and
// every other panel shows a blurred silhouette of its real content with a
// loading seal, the same visual language as the locked previews. Content
// then resolves in place with no layout shift.
import { useEffect, useMemo, useState } from "react";
import Masthead from "@/components/Masthead";

const STEPS = [
  "establishing telemetry link",
  "resolving system coordinates",
  "reading worldwide route registry (top 1000)",
  "measuring stargazer velocity (last 100 stars)",
  "scanning neighboring systems",
  "computing overtake vectors",
];

const SLOW_NOTE = "GitHub turbulence · retrying upstream";

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

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
  const lines = STEPS.slice(0, visible).slice(-4);
  return (
    <div className="numeral flex flex-col items-end gap-0.5 text-right text-micro">
      {lines.map((s, i) => {
        const isLast = i === lines.length - 1 && visible < STEPS.length;
        return (
          <span key={s} className={isLast ? "text-dim" : "text-faint"}>
            {isLast ? "> " : "✓ "}
            {s}
          </span>
        );
      })}
      {slow ? <span className="text-warn">{SLOW_NOTE}</span> : null}
    </div>
  );
}

// The loading seal: same badge language as the locked previews, but about
// telemetry being on its way instead of a paywall.
function Seal() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <span className="numeral bg-void/75 px-3 py-1 text-micro tracking-[0.3em] text-dim">
        ◌ SCANNING · TELEMETRY INBOUND
      </span>
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

// Star chart band, alive on first paint: twinkling specks over the void and
// the route timeline with its gate ticks. The real ships then fade in over
// the same sky.
function StarfieldSkeleton({ mobile = false }: { mobile?: boolean }) {
  const stars = useMemo(() => {
    const rand = seeded(20260611);
    return Array.from({ length: mobile ? 26 : 44 }, () => ({
      left: rand() * 96 + 2,
      top: rand() * 78 + 4,
      size: rand() < 0.78 ? 2 : 3,
      delay: rand() * 4,
      dur: 2.6 + rand() * 2.4,
      o: 0.2 + rand() * 0.5,
    }));
  }, [mobile]);
  const ticks = [12, 27, 42, 57, 72, 87];
  return (
    <div className={`relative overflow-hidden ${mobile ? "h-[600px]" : "h-[430px]"}`}>
      <style>{`@keyframes sk-tw { 0%, 100% { opacity: 0.12 } 50% { opacity: 0.85 } }`}</style>
      <span className="numeral absolute left-1 top-1 text-micro tracking-[0.25em] text-faint">
        LOCAL SYSTEM
      </span>
      {stars.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-speck"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            opacity: s.o,
            animation: `sk-tw ${s.dur.toFixed(2)}s ease-in-out ${s.delay.toFixed(2)}s infinite`,
          }}
        />
      ))}
      {/* route timeline with gate ticks */}
      <div className="absolute inset-x-2 bottom-10">
        <span className="numeral absolute -top-5 left-0 text-micro tracking-[0.25em] text-faint">
          ROUTE TO THE CORE
        </span>
        <div className="h-px w-full bg-grid" />
        {ticks.map((t) => (
          <span key={t} className="absolute top-[-3px] h-[7px] w-px bg-grid" style={{ left: `${t}%` }} />
        ))}
        <span
          className="absolute top-[-4px] h-[9px] w-[9px] rounded-full bg-accent/60"
          style={{ left: "96%", animation: "sk-tw 2.4s ease-in-out infinite" }}
        />
      </div>
    </div>
  );
}

// Blurred silhouettes of the real panels, pulsing while telemetry arrives.
function VelocitySilhouette() {
  const bars = useMemo(() => {
    const rand = seeded(42);
    return Array.from({ length: 30 }, () => 12 + rand() * 88);
  }, []);
  return (
    <div className="relative">
      <div className="flex h-[260px] items-end gap-[5px] blur-[1.5px]" aria-hidden>
        {bars.map((h, i) => (
          <div key={i} className="flex-1 animate-pulse bg-accent/15" style={{ height: `${h}%` }} />
        ))}
      </div>
      <Seal />
    </div>
  );
}

function CurveSilhouette({ h = 280 }: { h?: number }) {
  return (
    <div className="relative">
      <svg viewBox="0 0 400 100" preserveAspectRatio="none" className="block w-full blur-[1.5px]" style={{ height: h }} aria-hidden>
        <path
          d="M 0 96 C 80 92, 120 70, 170 52 C 230 32, 290 22, 400 12 L 400 100 L 0 100 Z"
          className="animate-pulse"
          fill="rgba(83, 214, 232, 0.10)"
        />
        <path
          d="M 0 96 C 80 92, 120 70, 170 52 C 230 32, 290 22, 400 12"
          fill="none"
          stroke="rgba(83, 214, 232, 0.35)"
          strokeWidth={1.5}
        />
      </svg>
      <Seal />
    </div>
  );
}

function HeatmapSilhouette() {
  const cells = useMemo(() => {
    const rand = seeded(7);
    return Array.from({ length: 24 * 7 }, () => rand());
  }, []);
  return (
    <div className="relative">
      <div className="grid h-[220px] grid-cols-[repeat(24,1fr)] gap-[3px] blur-[1px]" aria-hidden>
        {cells.map((v, i) => (
          <div key={i} className="animate-pulse" style={{ background: `rgba(83, 214, 232, ${0.04 + v * 0.14})` }} />
        ))}
      </div>
      <Seal />
    </div>
  );
}

function StepsSilhouette({ h = 220 }: { h?: number }) {
  return (
    <div className="relative">
      <svg viewBox="0 0 400 100" preserveAspectRatio="none" className="block w-full blur-[1.5px]" style={{ height: h }} aria-hidden>
        <path
          d="M 0 80 H 60 V 66 H 130 V 58 H 200 V 42 H 280 V 30 H 340 V 18 H 400"
          fill="none"
          className="animate-pulse"
          stroke="rgba(83, 214, 232, 0.3)"
          strokeWidth={2}
        />
      </svg>
      <Seal />
    </div>
  );
}

function LadderSilhouette() {
  const rows = useMemo(() => {
    const rand = seeded(99);
    return Array.from({ length: 9 }, () => 20 + rand() * 75);
  }, []);
  return (
    <div className="relative">
      <div className="flex h-[300px] flex-col justify-between py-2 blur-[1px]" aria-hidden>
        {rows.map((w, i) => (
          <div key={i} className="h-4 animate-pulse bg-accent/12" style={{ width: `${w}%` }} />
        ))}
      </div>
      <Seal />
    </div>
  );
}

function LogSilhouette() {
  return (
    <div className="relative">
      <div className="flex flex-col gap-3 py-1 blur-[1px]" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <Bar w="w-20" />
            <Bar w={i % 2 ? "w-2/3" : "w-1/2"} />
          </div>
        ))}
      </div>
      <Seal />
    </div>
  );
}

export default function ExplorerLoading() {
  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      <div className="rise px-1">
        <Masthead />
      </div>
      {/* header: identity placeholders left, the scan log right (the real
          metrics only appear when they are real numbers) */}
      <header className="hud rise px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
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
          {/* reserve the metrics row height so the header doesn't grow when
              the real numbers land */}
          <div className="flex min-h-[52px] items-start">
            <ScanLog />
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
          <StarfieldSkeleton />
        </div>
        <div className="lg:hidden">
          <StarfieldSkeleton mobile />
        </div>
      </PanelSkeleton>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <PanelSkeleton index="02" title="Velocity, stars per hour" meta="24h vs previous 24h" className="lg:col-span-8" delay={160}>
          <VelocitySilhouette />
        </PanelSkeleton>
        <PanelSkeleton index="03" title="Milestone projections" meta="unlocks with tracking" className="lg:col-span-4" delay={240}>
          <div className="relative">
            <div className="flex h-[260px] flex-col justify-between py-2 blur-[1px]" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between gap-4">
                  <Bar w="w-24" />
                  <Bar w="w-32" />
                </div>
              ))}
            </div>
            <Seal />
          </div>
        </PanelSkeleton>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PanelSkeleton index="04" title="Daily ladder" meta="unlocks with tracking" delay={320}>
          <LadderSilhouette />
        </PanelSkeleton>
        <PanelSkeleton index="05" title="Cumulative stars" meta="real data · interactive" delay={400}>
          <div className="flex flex-col gap-2">
            <CurveSilhouette />
            <div className="h-9 w-72 animate-pulse self-start border border-grid bg-grid/30" />
          </div>
        </PanelSkeleton>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <PanelSkeleton index="06" title="Activity heatmap" meta="unlocks with tracking" className="lg:col-span-7" delay={480}>
          <HeatmapSilhouette />
        </PanelSkeleton>
        <PanelSkeleton index="07" title="World rank over time" meta="unlocks with tracking" className="lg:col-span-5" delay={560}>
          <StepsSilhouette />
        </PanelSkeleton>
      </div>

      <PanelSkeleton index="08" title="Mission log" meta="unlocks with tracking" delay={640}>
        <LogSilhouette />
      </PanelSkeleton>
    </main>
  );
}
