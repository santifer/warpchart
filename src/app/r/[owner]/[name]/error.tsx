"use client";

// Themed error boundary for the explorer. Staying inside the app shell (no
// full document reload) also keeps the ambient soundscape alive.
// It does not guess the cause: the digest is the key to the server's
// "request.failed" log line (src/instrumentation.ts), which has the real one.
export default function ExplorerError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
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
          The scan of this system failed on the server. Nothing is broken on
          your side, and a retry often gets through.
        </p>
        {error.digest && (
          <p className="numeral text-data tracking-[0.2em] text-dim">
            REF <span className="select-all text-ink">{error.digest}</span>
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => unstable_retry()}
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
