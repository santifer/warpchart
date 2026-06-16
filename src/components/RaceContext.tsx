"use client";

// Lifts the "is this chart in race mode?" state ABOVE the chart, so the toggle
// can live in the panel HEADER (next to the title) while the chart fills the
// whole body. The provider also fetches the repo's rivals once (cache-only
// overtakes, zero GitHub cost) so the threat label can show before any click —
// that is the whole invitation. CompareLab (the chart) and RaceToggle (the
// header button) both read this context; standalone /compare has no provider,
// so useRace() returns a disabled default.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { shortRepo } from "@/lib/compare";

interface OvertakeLite {
  hunter: { repo: string };
  victim: { repo: string };
  etaDays: number;
}
interface NeighborLite {
  repo: string;
}
interface RaceState {
  enabled: boolean; // there is at least one rival to race against
  raceOn: boolean;
  rivals: string[];
  threat: { repo: string; etaDays: number } | null;
  toggle: () => void;
}

const RaceCtx = createContext<RaceState>({
  enabled: false,
  raceOn: false,
  rivals: [],
  threat: null,
  toggle: () => {},
});

export const useRace = () => useContext(RaceCtx);

export function RaceProvider({
  repo,
  children,
  initialRaceOn = false,
}: {
  repo: string;
  children: ReactNode;
  // Start already in race mode (used on the pricing page, where the crossing
  // lines ARE the proof). On /r/ it stays false so the visitor opts in.
  initialRaceOn?: boolean;
}) {
  const [raceOn, setRaceOn] = useState(initialRaceOn);
  const [rivals, setRivals] = useState<string[]>([]);
  const [threat, setThreat] = useState<{ repo: string; etaDays: number } | null>(null);

  useEffect(() => {
    if (!repo) return;
    let stop = false;
    (async () => {
      try {
        // Imminent overtakes give the dramatic threat (with a countdown); the
        // ranking neighbours guarantee a race for repos with NO imminent
        // crossover (e.g. a big, stable repo whose gaps are huge). Both are
        // cache-only — zero GitHub cost.
        const [ovR, rpR] = await Promise.all([
          fetch(`/api/v1/overtakes?repo=${encodeURIComponent(repo)}`),
          fetch(`/api/v1/repo?repo=${encodeURIComponent(repo)}`),
        ]);
        const ov = ovR.ok ? ((await ovR.json()) as { hunters?: OvertakeLite[]; targets?: OvertakeLite[] }) : {};
        const rp = rpR.ok ? ((await rpR.json()) as { ahead?: NeighborLite[]; behind?: NeighborLite[] }) : {};
        const hunters = (ov.hunters ?? []).slice().sort((a, b) => a.etaDays - b.etaDays);
        const targets = (ov.targets ?? []).slice().sort((a, b) => a.etaDays - b.etaDays);
        const seen = new Set([repo.toLowerCase()]);
        const list: string[] = [];
        // nearest threat first, then the repos it is catching, then fill with
        // the closest ranking neighbours (behind = on your heels, ahead = your
        // next target) so EVERY ranked repo can race
        for (const r of [
          ...hunters.slice(0, 2).map((h) => h.hunter.repo),
          ...targets.slice(0, 2).map((t) => t.victim.repo),
          ...(rp.behind ?? []).slice(0, 2).map((n) => n.repo),
          ...(rp.ahead ?? []).slice(0, 2).map((n) => n.repo),
        ]) {
          const k = r.toLowerCase();
          if (!seen.has(k)) {
            seen.add(k);
            list.push(r);
          }
        }
        if (stop) return;
        setRivals(list.slice(0, 4));
        setThreat(
          hunters.length
            ? { repo: hunters[0].hunter.repo, etaDays: Math.max(1, Math.round(hunters[0].etaDays)) }
            : null
        );
      } catch {
        /* rivals are optional */
      }
    })();
    return () => {
      stop = true;
    };
  }, [repo]);

  return (
    <RaceCtx.Provider
      value={{ enabled: rivals.length > 0, raceOn, rivals, threat, toggle: () => setRaceOn((v) => !v) }}
    >
      {children}
    </RaceCtx.Provider>
  );
}

// The threat-alert toggle, designed to live in a panel header's action slot.
// It carries the stake (the nearest hunter + countdown) so the click is earned.
export function RaceToggle() {
  const { enabled, raceOn, threat, toggle } = useRace();
  if (!enabled) return null;
  return (
    <button
      onClick={toggle}
      aria-label={raceOn ? "back to the solo chart" : "see the race"}
      className={`numeral flex items-center gap-1.5 border px-2.5 py-1 text-micro tracking-[0.14em] transition-colors ${
        raceOn
          ? "border-grid text-dim hover:border-accent/50 hover:text-accent"
          : "race-invite border-warn/50 text-warn hover:border-warn"
      }`}
    >
      {raceOn ? (
        "◂ SOLO"
      ) : threat ? (
        <>
          <span className="race-pulse h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <span className="text-ink">{shortRepo(threat.repo)}</span>
          <span className="text-warn">· {threat.etaDays}d</span>
          <span className="text-accent">▸ RACE</span>
        </>
      ) : (
        <>
          <span className="race-pulse h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
          <span className="text-accent">SEE THE RACE ▸</span>
        </>
      )}
    </button>
  );
}
