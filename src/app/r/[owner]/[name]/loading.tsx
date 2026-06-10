// Instant skeleton while the explorer gathers live telemetry for a repo.
// First visits can take several seconds (GitHub API round-trips); this keeps
// the navigation feeling immediate.
export default function ExplorerLoading() {
  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      <div className="hud flex flex-col items-start gap-3 px-6 py-6">
        <div className="flex items-center gap-3">
          <span className="pulse-dot" />
          <span className="font-display text-[11px] tracking-[0.3em] text-dim">
            ESTABLISHING TELEMETRY LINK
          </span>
        </div>
        <p className="numeral text-[10px] text-faint">
          first scan of a system takes a few seconds · measuring stars, rank and neighbors
        </p>
      </div>
      <div className="hud h-[420px] animate-pulse opacity-60" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="hud h-[260px] animate-pulse opacity-50 lg:col-span-8" />
        <div className="hud h-[260px] animate-pulse opacity-40 lg:col-span-4" />
      </div>
    </main>
  );
}
