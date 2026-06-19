// Server-safe blurred panel silhouettes for the LOCKED previews on a /r/ page.
// They show the SHAPE of a panel WITHOUT leaking the house tenant's real data
// (career-ops) into a stranger's page — the old locked previews rendered
// career-ops's actual ladder/heatmap/mission log under a 2px blur. No hooks
// (seeded is deterministic), so these render in the server component; the
// surrounding <Locked> supplies the seal/lock overlay.

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

export function VelocitySilhouette() {
  const rand = seeded(42);
  const bars = Array.from({ length: 30 }, () => 12 + rand() * 88);
  return (
    <div className="flex h-[260px] items-end gap-[5px] blur-[1.5px]" aria-hidden>
      {bars.map((h, i) => (
        <div key={i} className="flex-1 animate-pulse bg-accent/15" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

export function HeatmapSilhouette() {
  const rand = seeded(7);
  const cells = Array.from({ length: 24 * 7 }, () => rand());
  return (
    <div className="grid h-[220px] grid-cols-[repeat(24,1fr)] gap-[3px] blur-[1px]" aria-hidden>
      {cells.map((v, i) => (
        <div key={i} className="animate-pulse" style={{ background: `rgba(83, 214, 232, ${0.04 + v * 0.14})` }} />
      ))}
    </div>
  );
}

export function StepsSilhouette({ h = 220 }: { h?: number }) {
  return (
    <svg viewBox="0 0 400 100" preserveAspectRatio="none" className="block w-full blur-[1.5px]" style={{ height: h }} aria-hidden>
      <path
        d="M 0 80 H 60 V 66 H 130 V 58 H 200 V 42 H 280 V 30 H 340 V 18 H 400"
        fill="none"
        className="animate-pulse"
        stroke="rgba(83, 214, 232, 0.3)"
        strokeWidth={2}
      />
    </svg>
  );
}

export function LadderSilhouette() {
  const rand = seeded(99);
  const rows = Array.from({ length: 9 }, () => 20 + rand() * 75);
  return (
    <div className="flex h-[300px] flex-col justify-between py-2 blur-[1px]" aria-hidden>
      {rows.map((w, i) => (
        <div key={i} className="h-4 animate-pulse bg-accent/12" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export function LogSilhouette() {
  return (
    <div className="flex flex-col gap-3 py-1 blur-[1px]" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-3 w-20 animate-pulse bg-grid/80" />
          <div className={`h-3 animate-pulse bg-grid/80 ${i % 2 ? "w-2/3" : "w-1/2"}`} />
        </div>
      ))}
    </div>
  );
}
