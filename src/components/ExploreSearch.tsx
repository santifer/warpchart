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

  const ask = async () => {
    const query = q.trim();
    if (query.length < 2) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/find?q=${encodeURIComponent(query)}`);
      const data = (await res.json()) as { results?: AskEntry[] };
      setResults(data.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

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
        <>
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
              className="numeral w-full bg-transparent text-lg text-ink outline-none placeholder:text-faint"
              aria-label="ask for a technology"
            />
            <button
              onClick={ask}
              className="numeral shrink-0 border border-grid px-3 py-1.5 text-micro tracking-[0.2em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
            >
              {busy ? "…" : "ASK →"}
            </button>
          </div>

          {results !== null ? (
            <div className="hud flex flex-col divide-y divide-grid/60 p-1 text-left">
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
                      src={`https://github.com/${e.repo.split("/")[0]}.png?size=44`}
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
        </>
      )}
    </div>
  );
}
