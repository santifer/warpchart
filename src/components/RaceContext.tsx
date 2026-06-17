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

interface NeighborLite {
  repo: string;
  gap: number; // their stars minus ours: >0 = ahead of us, <0 = behind us
  velocityPerDay: number | null;
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
        // The race = the repos we will actually CROSS, computed from the same
        // live neighbour velocities the route chart uses (cache-only, zero
        // GitHub cost): the ones AHEAD we are catching (we're faster), plus the
        // two closest BEHIND that are catching US (they're faster) — at any ETA,
        // a day or twenty. A repo only earns a lane if a crossover is projected.
        const rpR = await fetch(`/api/v1/repo?repo=${encodeURIComponent(repo)}`);
        const rp = rpR.ok
          ? ((await rpR.json()) as {
              velocityPerDay?: number | null;
              ahead?: NeighborLite[];
              behind?: NeighborLite[];
            })
          : {};
        const ownV = rp.velocityPerDay ?? 0;
        // ahead of us (more stars) AND we are closing (faster) -> we overtake
        const willPass = (rp.ahead ?? [])
          .filter((n) => n.gap > 0 && (n.velocityPerDay ?? 0) < ownV)
          .map((n) => ({ repo: n.repo, eta: n.gap / Math.max(ownV - (n.velocityPerDay ?? 0), 1e-6) }))
          .sort((a, b) => a.eta - b.eta);
        // behind us (fewer stars) AND faster than us -> they overtake us
        const threats = (rp.behind ?? [])
          .filter((n) => (n.velocityPerDay ?? 0) > ownV)
          .map((n) => ({ repo: n.repo, eta: Math.abs(n.gap) / Math.max((n.velocityPerDay ?? 0) - ownV, 1e-6) }))
          .sort((a, b) => a.eta - b.eta);
        const seen = new Set([repo.toLowerCase()]);
        const list: string[] = [];
        for (const r of [...willPass.slice(0, 2).map((x) => x.repo), ...threats.slice(0, 2).map((x) => x.repo)]) {
          const k = r.toLowerCase();
          if (!seen.has(k)) {
            seen.add(k);
            list.push(r);
          }
        }
        // fallback so a stable repo with no projected crossover still gets a
        // race: its nearest neighbours, ahead and behind
        if (!list.length) {
          for (const r of [...(rp.ahead ?? []).slice(0, 2), ...(rp.behind ?? []).slice(0, 2)].map((n) => n.repo)) {
            const k = r.toLowerCase();
            if (!seen.has(k)) {
              seen.add(k);
              list.push(r);
            }
          }
        }
        if (stop) return;
        setRivals(list.slice(0, 4));
        // the threat = the soonest repo about to overtake US (watch your back)
        setThreat(
          threats.length
            ? { repo: threats[0].repo, etaDays: Math.max(1, Math.round(threats[0].eta)) }
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
