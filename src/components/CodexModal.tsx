"use client";

// The CODEX: a system's lore, distilled from its README into a sci-fi
// discovery-log dossier (see src/lib/codex.ts). A button in the console header
// opens a modal; the FIRST visitor charts the system (the API generates and
// caches it), everyone after reads it instantly. The modal leads with the
// author and the repo's own social card, big, then the tagline and the entry.
import { useCallback, useEffect, useRef, useState } from "react";

interface Codex {
  repo: string;
  tagline: string;
  entry: string;
}

export default function CodexModal({ repo }: { repo: string }) {
  const [owner, name] = repo.split("/");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "charting" | "ready" | "empty">("idle");
  const [codex, setCodex] = useState<Codex | null>(null);
  const fetched = useRef(false);

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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="numeral group flex items-center gap-2 border border-grid px-3 py-1.5 text-micro tracking-[0.18em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
        title="Read this system's codex"
      >
        <span className="cdx-pulse h-[6px] w-[6px] rounded-full bg-accent/70" aria-hidden />
        TRANSMISSION
      </button>

      {open ? (
        <div
          className="cdx-backdrop fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto px-4 py-8 sm:py-14"
          onClick={() => setOpen(false)}
        >
          <div
            className="cdx-panel hud relative w-full max-w-[680px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header: the repo's own social card, blurred, with the author
                avatar riding on top — the system and its maker, up front */}
            <div className="relative h-[150px] overflow-hidden border-b border-grid sm:h-[180px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://opengraph.githubassets.com/codex/${owner}/${name}`}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-[2px]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-void via-void/70 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 p-4 sm:p-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://github.com/${owner}.png`}
                  alt={owner}
                  width={64}
                  height={64}
                  className="h-16 w-16 shrink-0 border border-accent/40 shadow-[0_0_24px_rgba(83,214,232,0.25)]"
                />
                <div className="min-w-0 pb-1">
                  <div className="numeral text-micro tracking-[0.3em] text-accent/80">CODEX · SYSTEM DOSSIER</div>
                  <div className="font-display truncate text-lg uppercase tracking-[0.12em] text-star">{repo}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="numeral absolute right-3 top-3 border border-grid bg-void/60 px-2 py-1 text-micro text-dim transition-colors hover:text-accent"
                aria-label="Close"
              >
                ESC ✕
              </button>
            </div>

            {/* body */}
            <div className="px-5 py-5 sm:px-7 sm:py-6">
              {state === "charting" ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <span className="cdx-pulse text-accent" aria-hidden>◌</span>
                  <p className="numeral text-data tracking-[0.18em] text-dim">
                    charting this system · first light…
                  </p>
                  <p className="numeral text-micro text-faint">
                    recording its story so the next explorer can find it
                  </p>
                </div>
              ) : state === "empty" ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <p className="numeral text-data tracking-[0.18em] text-dim">◌ uncharted system</p>
                  <p className="numeral text-micro text-faint">no transmission could be recovered yet</p>
                </div>
              ) : codex ? (
                <div className="flex flex-col gap-4">
                  <p className="font-display text-lg leading-snug tracking-[0.02em] text-accent">
                    {codex.tagline}
                  </p>
                  {codex.entry.split(/\n{2,}/).map((para, i) => (
                    <p key={i} className="text-sm font-light leading-relaxed text-dim">
                      {para.trim()}
                    </p>
                  ))}
                  <a
                    href={`https://github.com/${repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="numeral mt-1 self-start text-micro tracking-[0.18em] text-accent/80 transition-colors hover:text-accent"
                  >
                    VISIT THE SOURCE →
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
