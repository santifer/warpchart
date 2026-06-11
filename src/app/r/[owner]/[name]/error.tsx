"use client";

// Themed error boundary for the explorer. Staying inside the app shell (no
// full document reload) also keeps the ambient soundscape alive.
export default function ExplorerError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      <div className="hud flex flex-col items-start gap-4 border-warn/40 px-6 py-8">
        <div className="flex items-center gap-3">
          <span className="h-[7px] w-[7px] rounded-full bg-warn" />
          <span className="font-display text-data tracking-[0.3em] text-warn">
            TELEMETRY LINK FAILED
          </span>
        </div>
        <p className="numeral max-w-xl text-data leading-relaxed text-dim">
          The GitHub API hit turbulence while scanning this system (transient
          5xx). Nothing is broken on your side: a retry usually gets through.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => reset()}
            className="numeral border border-accent/40 px-4 py-2 text-data tracking-[0.2em] text-accent transition-colors hover:bg-accent/10"
          >
            ▶ RETRY SCAN
          </button>
          <a
            href="/"
            className="numeral border border-grid px-4 py-2 text-data tracking-[0.2em] text-dim transition-colors hover:text-ink"
          >
            RETURN TO BASE
          </a>
        </div>
      </div>
    </main>
  );
}
