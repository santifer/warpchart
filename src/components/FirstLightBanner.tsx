"use client";

// FIRST LIGHT: the post-payment landing state. Polar redirects a buyer to
// /r/owner/name?welcome=1; for the few minutes until the collector's
// provisioning redeploy unlocks their console, this HUD turns the wait into
// a visible launch sequence instead of a blank locked page. It self-gates on
// the welcome flag CLIENT-side (so the server page never reads searchParams
// and the explorer's ISR cache stays intact), steps through the real pipeline
// stages, polls /api/tenant-status, and reloads once into the live console.
import { useEffect, useRef, useState } from "react";

const STEPS = [
  "PAYMENT CONFIRMED",
  "PROVISIONING MISSION",
  "COLLECTING FIRST LIGHT",
  "CONSOLE ONLINE",
];

export default function FirstLightBanner({ repo }: { repo: string }) {
  const name = repo.split("/")[1] ?? repo;
  const [show, setShow] = useState(false);
  const [stage, setStage] = useState(1); // index of the step currently in progress
  const [live, setLive] = useState(false);
  const [preview, setPreview] = useState<{ stars: number; rank: number } | null>(null);
  const reloaded = useRef(false);

  // gate on ?welcome=1 (client-side, so the server render keeps its ISR cache).
  // Intentional one-time read of a browser-only value on mount; server and
  // first client render both yield null, so there is no hydration mismatch.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("welcome") === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShow(true);
    }
  }, []);

  // honest time-based progression: provisioning -> collecting. It never claims
  // ONLINE on a timer; only the poll below promotes to ONLINE.
  useEffect(() => {
    if (!show || live) return;
    const t = setTimeout(() => setStage((s) => Math.max(s, 2)), 75_000);
    return () => clearTimeout(t);
  }, [show, live]);

  // poll for the real unlock; on success, light the last step and reveal once
  useEffect(() => {
    if (!show) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`/api/tenant-status?repo=${encodeURIComponent(repo)}`, {
          cache: "no-store",
        });
        const j = (await r.json()) as {
          live?: boolean;
          preview?: { stars: number; rank: number } | null;
        };
        if (!stopped && j?.preview) setPreview(j.preview);
        if (j?.live && !stopped) {
          setLive(true);
          setStage(3);
          if (!reloaded.current) {
            reloaded.current = true;
            setTimeout(() => window.location.reload(), 2400);
          }
          return; // unlocked: stop polling
        }
      } catch {
        /* transient: keep polling */
      }
      if (!stopped) timer = setTimeout(tick, 20_000);
    };
    timer = setTimeout(tick, 8_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [show, repo]);

  if (!show) return null;

  const pct = live ? 100 : stage >= 2 ? 75 : 40;
  const stepState = (i: number): "done" | "active" | "pending" =>
    live || i < stage ? "done" : i === stage ? "active" : "pending";

  return (
    <div className="hud relative overflow-hidden border-accent/50 px-4 py-4 sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <span className="numeral inline-block border border-accent/50 bg-accent/10 px-2 py-0.5 text-micro tracking-[0.28em] text-accent">
            ◉ FIRST LIGHT
          </span>
          <h2 className="mt-2 font-display text-base tracking-[0.12em] text-ink sm:text-lg">
            {live ? `${name.toUpperCase()} IS LIVE` : `CHARTING ${name.toUpperCase()}`}
          </h2>
          <p className="mt-1 max-w-[60ch] text-sm font-light leading-snug text-dim">
            {live
              ? "Console online. Revealing your mission deck…"
              : "Payment received. Your console is coming online, usually within minutes."}
          </p>
          {!live && preview ? (
            <p className="numeral mt-2 text-data tracking-[0.12em] text-accent">
              {name} · #{preview.rank.toLocaleString("en-US")} worldwide ·{" "}
              {preview.stars.toLocaleString("en-US")} ★ · recording started
            </p>
          ) : null}
        </div>
        <span className="numeral shrink-0 text-micro tracking-[0.2em] text-faint">
          {live ? "▸ ONLINE" : "◌ ACQUIRING SIGNAL"}
        </span>
      </div>

      {/* progress rail */}
      <div className="mt-4 h-px w-full bg-grid">
        <div
          className="h-px bg-accent transition-all duration-1000 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* launch sequence */}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {STEPS.map((label, i) => {
          const st = stepState(i);
          const dot = st === "done" ? "✓" : st === "active" ? "◉" : "○";
          return (
            <div
              key={label}
              className={`flex items-center gap-1.5 ${st === "pending" ? "text-faint" : "text-accent"}`}
            >
              <span className={`numeral text-data ${st === "active" ? "animate-pulse" : ""}`}>
                {dot}
              </span>
              <span className="numeral text-micro tracking-[0.16em]">{label}</span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-micro font-light leading-relaxed text-faint">
        You can close this tab, tracking has already started and cannot lose a star. We will email
        you when {name} is fully live. The public snapshot below stays free, always.
      </p>
    </div>
  );
}
