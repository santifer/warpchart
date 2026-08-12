"use client";

// The CODEX: a system's lore, distilled from its README into a sci-fi
// discovery-log dossier (see src/lib/codex.ts). A button in the console header
// opens an immersive modal. It is always DARK (an instrument you open, not a
// page), leads with the maintainer as the system's commander, grounds the
// narrative in real telemetry, then unrolls the field log.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ghAvatar } from "@/lib/avatar";

interface Codex {
  repo: string;
  tagline: string;
  entry: string;
}

export interface CodexStats {
  stars: number;
  rank: number | null;
  vPerDay: number;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
function fmtCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

export default function CodexModal({ repo, stats }: { repo: string; stats?: CodexStats }) {
  const [owner, name] = repo.split("/");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<"idle" | "charting" | "ready" | "empty">("idle");
  const [codex, setCodex] = useState<Codex | null>(null);
  const [avatarOk, setAvatarOk] = useState(true);
  const fetched = useRef(false);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    if (fetched.current) return;
    fetched.current = true;
    setState("charting");
    try {
      const res = await fetch(`/api/codex?repo=${encodeURIComponent(repo)}`);
      if (res.status === 200) {
        setCodex((await res.json()) as Codex);
        setState("ready");
      } else {
        setState("empty");
      }
    } catch {
      setState("empty");
    }
  }, [repo]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const paras = codex ? codex.entry.split(/\n+/).map((p) => p.trim()).filter(Boolean) : [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="numeral group inline-flex items-center gap-2 border border-grid px-3 py-1.5 text-micro tracking-[0.18em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
        title="Open this system's codex"
      >
        <span className="cdx-pulse h-[6px] w-[6px] rounded-full bg-accent/70" aria-hidden />
        TRANSMISSION
      </button>

      {open && mounted
        ? createPortal(
            <div
              className="cdx-dark cdx-backdrop fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto px-3 py-6 sm:items-center sm:py-10"
              onClick={() => setOpen(false)}
            >
              <div
                className="cdx-panel relative w-full max-w-[560px] overflow-hidden border border-accent/20 bg-void shadow-[0_30px_120px_rgba(0,0,0,0.7)]"
                onClick={(e) => e.stopPropagation()}
              >
                {/* close */}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="numeral absolute right-3 top-3 z-20 flex h-7 items-center gap-1 border border-grid bg-void/70 px-2 text-micro text-dim backdrop-blur transition-colors hover:border-accent/50 hover:text-accent"
                  aria-label="Close"
                >
                  ESC ✕
                </button>

                {/* ── HERO: the commander + the system ── */}
                <div className="cdx-hero-sky relative px-5 pb-5 pt-6 sm:px-7 sm:pt-7">
                  <div className="numeral text-micro tracking-[0.35em] text-accent/70">
                    CODEX · SYSTEM DOSSIER
                  </div>
                  <div className="mt-4 flex items-center gap-4 sm:gap-5">
                    {/* avatar with a HUD reticle frame */}
                    <div className="relative shrink-0">
                      <div className="cdx-reticle relative h-20 w-20 sm:h-24 sm:w-24">
                        <div className="absolute inset-0 grid place-items-center bg-hull text-2xl font-semibold text-faint">
                          {(owner?.[0] ?? "?").toUpperCase()}
                        </div>
                        {avatarOk ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={ghAvatar(owner, 200)}
                            alt={owner}
                            className="absolute inset-0 h-full w-full object-cover"
                            onError={() => setAvatarOk(false)}
                          />
                        ) : null}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="numeral text-micro tracking-[0.25em] text-faint">
                        MAINTAINER
                      </div>
                      <div className="font-display truncate text-base tracking-[0.06em] text-star">
                        {owner}
                      </div>
                      <div className="mt-1 truncate text-sm text-dim">
                        <span className="text-accent">/</span> {name}
                      </div>
                    </div>
                  </div>

                  {/* ── telemetry HUD ── */}
                  {stats ? (
                    <div className="mt-5 grid grid-cols-3 divide-x divide-grid border border-grid bg-void/40">
                      <div className="px-3 py-2.5">
                        <div className="numeral text-[0.6rem] tracking-[0.2em] text-faint">STARS</div>
                        <div className="numeral mt-0.5 text-base text-ink">{fmtCompact(stats.stars)}</div>
                      </div>
                      <div className="px-3 py-2.5">
                        <div className="numeral text-[0.6rem] tracking-[0.2em] text-faint">WORLD RANK</div>
                        <div className="numeral mt-0.5 text-base text-ink">
                          {stats.rank !== null ? `#${fmt(stats.rank)}` : "n/a"}
                        </div>
                      </div>
                      <div className="px-3 py-2.5">
                        <div className="numeral text-[0.6rem] tracking-[0.2em] text-faint">VELOCITY</div>
                        <div className="numeral mt-0.5 text-base text-accent">
                          {Math.round(stats.vPerDay)}<span className="text-micro text-dim">/d</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* ── BODY: the field log ── */}
                <div className="border-t border-grid px-5 py-5 sm:px-7 sm:py-6">
                  {state === "charting" ? (
                    <div className="flex flex-col items-center gap-3 py-10 text-center">
                      <span className="cdx-pulse text-2xl text-accent" aria-hidden>◌</span>
                      <p className="numeral text-data tracking-[0.18em] text-dim">
                        charting this system · first light
                      </p>
                      <p className="numeral text-micro text-faint">
                        recording its story so the next explorer can find it
                      </p>
                    </div>
                  ) : state === "empty" ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                      <p className="numeral text-data tracking-[0.18em] text-dim">◌ uncharted system</p>
                      <p className="numeral text-micro text-faint">no transmission recovered yet</p>
                    </div>
                  ) : codex ? (
                    <div className="flex flex-col gap-5">
                      <p className="text-lg font-light leading-snug text-accent">{codex.tagline}</p>
                      <div className="cdx-rule flex flex-col gap-3 pl-4">
                        <div className="numeral text-micro tracking-[0.3em] text-faint">▸ FIELD LOG</div>
                        {paras.map((para, i) => (
                          <p key={i} className="text-sm font-light leading-relaxed text-dim">
                            {para}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* ── FOOTER ── */}
                <div className="flex items-center justify-between gap-3 border-t border-grid px-5 py-3.5 sm:px-7">
                  <a
                    href={`https://github.com/${repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="numeral text-micro tracking-[0.18em] text-accent transition-colors hover:text-star"
                  >
                    VISIT THE SOURCE →
                  </a>
                  <a
                    href="/codex"
                    className="numeral text-micro tracking-[0.18em] text-faint transition-colors hover:text-accent"
                  >
                    THE CODEX →
                  </a>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
