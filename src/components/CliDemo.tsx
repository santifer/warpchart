"use client";

// An animated terminal that types `warpchart find "..."` and reveals the real
// result, looping. It is the home's living proof that you can ask warpchart for
// the best repo for a need, from a shell or an agent. Pure web (no video file):
// crisp at any size, themeable, and it honours prefers-reduced-motion. The
// output is real, captured from the CLI against production.
import { useEffect, useRef, useState } from "react";

type Line = { k: "head" | "rank" | "dim"; t: string };

const CMD = 'warpchart find "best agentic memory system"';
const OUT: Line[] = [
  { k: "head", t: "◤ WARPCHART · best match" },
  { k: "rank", t: "1  claude-mem   82,275★  ▲131/d" },
  { k: "dim", t: "   persistent context across sessions for agents" },
  { k: "rank", t: "2  mem0         58,561★  ▲72/d" },
  { k: "dim", t: "   universal memory layer for AI agents" },
  { k: "rank", t: "3  mempalace    55,609★  ▲76/d" },
  { k: "dim", t: "   best-benchmarked open-source AI memory system" },
];

export default function CliDemo() {
  const [typed, setTyped] = useState("");
  const [shown, setShown] = useState(0);
  const [caret, setCaret] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const after = (ms: number, fn: () => void) => {
      const id = setTimeout(fn, ms);
      timers.current.push(id);
    };

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // honour reduced-motion: jump to the final frame (deferred so the state
      // update happens in a callback, not synchronously in the effect body)
      after(0, () => {
        setTyped(CMD);
        setShown(OUT.length);
        setCaret(false);
      });
      return () => timers.current.forEach(clearTimeout);
    }
    const run = () => {
      setTyped("");
      setShown(0);
      setCaret(true);
      // type the command
      for (let i = 1; i <= CMD.length; i++) after(180 + i * 38, () => setTyped(CMD.slice(0, i)));
      const typedDone = 180 + CMD.length * 38;
      // reveal output lines
      OUT.forEach((_, i) => after(typedDone + 350 + i * 170, () => setShown(i + 1)));
      const outDone = typedDone + 350 + OUT.length * 170;
      // hold, then loop
      after(outDone + 4200, run);
    };
    run();
    const blink = setInterval(() => setCaret((c) => !c), 530);
    timers.current.push(blink as unknown as ReturnType<typeof setTimeout>);
    return () => {
      timers.current.forEach(clearTimeout);
      clearInterval(blink);
      timers.current = [];
    };
  }, []);

  return (
    <div className="hud overflow-hidden font-mono" aria-hidden>
      <div className="flex items-center gap-1.5 border-b border-grid px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-faint/50" />
        <span className="h-2 w-2 rounded-full bg-faint/30" />
        <span className="h-2 w-2 rounded-full bg-faint/20" />
        <span className="numeral ml-2 text-micro tracking-[0.2em] text-faint">npx warpchart</span>
      </div>
      <div className="min-h-[260px] px-4 py-3 text-label leading-relaxed">
        <div className="text-dim">
          <span className="text-accent">$</span> {typed}
          {caret && typed.length < CMD.length ? <span className="text-accent">▋</span> : null}
        </div>
        <div className="mt-2 flex flex-col gap-0.5">
          {OUT.slice(0, shown).map((l, i) => (
            <div
              key={i}
              className={
                l.k === "head"
                  ? "text-accent tracking-[0.08em]"
                  : l.k === "rank"
                    ? "text-star"
                    : "text-faint"
              }
            >
              {l.t}
            </div>
          ))}
          {shown >= OUT.length ? (
            <div className="mt-2 text-faint">
              <span className="text-accent">$</span> <span className="text-accent">▋</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
