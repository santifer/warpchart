"use client";

// Landing search, dual-mode:
//   SCAN — the shared RepoSearch (autocomplete the top 1000 + deep space),
//          picking a repo warps THROUGH the galaxy to its system at /r/owner/name.
//   ASK  — natural language ("agentic memory", "react alternative"): hits the
//          recommender (/api/v1/find) and lists the best repos inline, in the
//          same card format, each opening its scan.
// An iOS-style toggle switches modes, with a one-shot pulse hint so visitors
// notice they can ask for any tech, not just look up a repo they already know.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import RepoSearch, { type CatalogEntry } from "./RepoSearch";
import { fmtCompact } from "@/lib/format";
import { ghAvatarForRepo } from "@/lib/avatar";

export type { CatalogEntry };

type Mode = "scan" | "ask";
interface AskEntry {
  repo: string;
  rank: number;
  stars: number;
  velocityPerDay: number;
  language: string | null;
  description: string | null;
}

export default function ExploreSearch({ catalog }: { catalog: CatalogEntry[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("scan");
  const [hinted, setHinted] = useState(true);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AskEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const askRef = useRef<HTMLInputElement | null>(null);

  // the activation hint fades on its own; switching modes also clears it
  useEffect(() => {
    const t = setTimeout(() => setHinted(false), 7000);
    return () => clearTimeout(t);
  }, []);

  const switchTo = (m: Mode) => {
    setMode(m);
    setHinted(false);
    if (m === "ask") setTimeout(() => askRef.current?.focus(), 0);
  };

  const askAbort = useRef<AbortController | null>(null);
  const runAsk = async (raw: string) => {
    const query = raw.trim();
    if (query.length < 2) {
      setResults(null);
      return;
    }
    askAbort.current?.abort();
    const ctrl = new AbortController();
    askAbort.current = ctrl;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/find?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
      const data = (await res.json()) as { results?: AskEntry[] };
      if (!ctrl.signal.aborted) setResults(data.results ?? []);
    } catch {
      if (!ctrl.signal.aborted) setResults([]);
    } finally {
      if (!ctrl.signal.aborted) setBusy(false);
    }
  };
  const ask = () => runAsk(q);

  // ASK searches as you type (debounced) so there is no need to press Enter;
  // Enter and the button still trigger it immediately.
  useEffect(() => {
    if (mode !== "ask") return;
    const query = q.trim();
    if (query.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults(null);
      return;
    }
    const t = setTimeout(() => runAsk(query), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, mode]);

  return (
    <div className="flex w-full flex-col gap-3">
      {/* SCAN / ASK toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label="search mode"
          className={`relative inline-flex select-none items-center rounded-full border border-grid bg-void/70 p-1 ${
            hinted ? "mode-toggle-hint" : ""
          }`}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-1 left-1 top-1 w-[calc(50%-0.25rem)] rounded-full bg-accent transition-transform duration-300 ease-out"
            style={{ transform: mode === "ask" ? "translateX(100%)" : "translateX(0)" }}
          />
          {(["scan", "ask"] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchTo(m)}
              className={`numeral relative z-10 min-w-[74px] rounded-full px-4 py-1.5 text-micro tracking-[0.22em] transition-colors ${
                mode === m ? "font-semibold text-void" : "text-dim hover:text-ink"
              }`}
            >
              {m === "scan" ? "SCAN" : "ASK"}
            </button>
          ))}
        </div>
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          {mode === "scan" ? "open any repo's live telemetry" : "describe what you need, get the best repos"}
        </span>
      </div>

      {mode === "scan" ? (
        <RepoSearch
          catalog={catalog}
          autoFocus
          size="lg"
          label="SCAN"
          onPick={(r) => {
            const stars = catalog.find((c) => c.r === r)?.s;
            if (window.__gxWarpTo?.(r, stars)) return;
            router.push(`/r/${r}`);
          }}
        />
      ) : (
        <div className="relative">
          <div className="hud flex items-center gap-3 px-5 py-4 transition-colors focus-within:border-accent/60">
            <span className="numeral shrink-0 text-label tracking-[0.25em] text-accent">ASK</span>
            <input
              ref={askRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") ask();
              }}
              placeholder="agentic memory, vector db, a react alternative…"
              className="numeral min-w-0 flex-1 bg-transparent text-lg text-ink outline-none placeholder:text-faint"
              aria-label="ask for a technology"
            />
            {busy ? <span className="pulse-dot shrink-0" aria-label="thinking" /> : null}
            <button
              onClick={ask}
              className="numeral shrink-0 border border-grid px-3 py-1.5 text-micro tracking-[0.2em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
            >
              ASK →
            </button>
          </div>

          {results !== null ? (
            // NO .hud here: .hud is un-layered so it beats Tailwind's .absolute
            // (position) AND .bg-void (its translucent gradient). A plain div
            // with .absolute floats correctly, and an inline opaque background
            // can't be overridden — so the dropdown overlays cleanly and opaque.
            <div
              className="absolute left-0 right-0 top-full z-30 mt-1 flex max-h-[min(62vh,460px)] flex-col divide-y divide-grid/60 overflow-y-auto border border-grid p-1 text-left"
              style={{ background: "var(--void)" }}
            >
              {results.length === 0 ? (
                <div className="numeral px-4 py-3 text-label text-faint">
                  {busy ? "searching…" : "no matches. try different words."}
                </div>
              ) : (
                results.slice(0, 10).map((e, i) => (
                  <Link
                    key={e.repo}
                    href={`/r/${e.repo}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/5"
                  >
                    <span className="numeral w-7 shrink-0 text-label text-faint">{String(i + 1).padStart(2, "0")}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={ghAvatarForRepo(e.repo, 44)}
                      alt=""
                      width={22}
                      height={22}
                      loading="lazy"
                      className="h-[22px] w-[22px] shrink-0 border border-grid"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="numeral truncate text-data text-ink">
                        {e.repo}
                        {e.language ? <span className="ml-2 text-micro text-faint">{e.language}</span> : null}
                      </span>
                      {e.description ? (
                        <span className="line-clamp-1 text-label font-light text-dim">{e.description}</span>
                      ) : null}
                    </span>
                    <span className="numeral shrink-0 text-label text-dim">
                      {fmtCompact(e.stars)} ★
                      {e.velocityPerDay > 0 ? <span className="ml-2 text-accent">▲ {e.velocityPerDay}/d</span> : null}
                    </span>
                  </Link>
                ))
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
