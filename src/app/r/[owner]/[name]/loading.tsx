"use client";

// Terminal-style progress while the explorer gathers live telemetry. The
// lines mirror the real steps of the scan; timing is approximate because a
// single server render cannot stream granular progress.
import { useEffect, useState } from "react";

const STEPS = [
  "establishing telemetry link",
  "resolving system coordinates",
  "reading worldwide route registry (top 1000)",
  "measuring stargazer velocity (last 100 stars)",
  "scanning neighboring systems",
  "computing overtake vectors",
];

const SLOW_NOTE = "still working · GitHub API turbulence, retrying upstream";

export default function ExplorerLoading() {
  const [visible, setVisible] = useState(1);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const step = setInterval(() => {
      setVisible((v) => Math.min(v + 1, STEPS.length));
    }, 950);
    const slowTimer = setTimeout(() => setSlow(true), 9000);
    return () => {
      clearInterval(step);
      clearTimeout(slowTimer);
    };
  }, []);

  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      <div className="hud px-6 py-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="pulse-dot" />
          <span className="font-display text-[11px] tracking-[0.3em] text-dim">
            ESTABLISHING TELEMETRY LINK
          </span>
        </div>
        <div className="numeral flex flex-col gap-1.5 text-[11px]">
          {STEPS.slice(0, visible).map((s, i) => {
            const done = i < visible - 1;
            return (
              <div key={s} className="flex items-baseline gap-2">
                <span className={done ? "text-accent" : "text-faint"}>
                  {done ? "✓" : ">"}
                </span>
                <span className={done ? "text-dim" : "text-ink"}>
                  {s}
                  {!done ? <span className="animate-pulse"> ▌</span> : null}
                </span>
              </div>
            );
          })}
          {slow ? (
            <div className="mt-2 flex items-baseline gap-2 text-warn">
              <span>!</span>
              <span>{SLOW_NOTE}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="hud h-[380px] animate-pulse opacity-50" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="hud h-[240px] animate-pulse opacity-40 lg:col-span-8" />
        <div className="hud h-[240px] animate-pulse opacity-30 lg:col-span-4" />
      </div>
    </main>
  );
}
