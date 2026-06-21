"use client";

// "My Constellation": the personal, no-login watchlist wall. Reads the
// localStorage watchlist, fetches each repo's current rank/stars/velocity from
// the cache-only /api/v1/repo, and shows the delta since your last look (the
// variable reward + the investment surface that makes alerts worth wiring).
// Per-user and client-only (localStorage): renders a harmless empty shell to a
// crawler, with no data to index.
import { useEffect, useState } from "react";
import Link from "next/link";
import Masthead from "@/components/Masthead";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import { getWatchlist, toggleWatch, recordSeen, type Watched } from "@/lib/watchlist";

interface Row extends Watched {
  stars?: number;
  rank?: number;
  vpd?: number | null;
  status: "loading" | "ranked" | "unranked" | "error";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export default function ConstellationPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const wl = getWatchlist();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    setRows(wl.map((w) => ({ ...w, status: "loading" })));
    let cancelled = false;
    (async () => {
      for (const w of wl) {
        try {
          const r = await fetch(`/api/v1/repo?repo=${encodeURIComponent(w.repo)}`, { cache: "no-store" });
          if (cancelled) return;
          if (r.ok) {
            const j = (await r.json()) as { stars?: number; rank?: number; velocityPerDay?: number | null };
            const stars = typeof j.stars === "number" ? j.stars : undefined;
            const rank = typeof j.rank === "number" ? j.rank : undefined;
            const vpd = typeof j.velocityPerDay === "number" ? j.velocityPerDay : null;
            setRows((prev) =>
              prev.map((x) => (x.repo === w.repo ? { ...x, stars, rank, vpd, status: "ranked" } : x)),
            );
            if (stars !== undefined && rank !== undefined) recordSeen(w.repo, stars, rank);
          } else {
            setRows((prev) =>
              prev.map((x) => (x.repo === w.repo ? { ...x, status: r.status === 404 ? "unranked" : "error" } : x)),
            );
          }
        } catch {
          if (!cancelled) {
            setRows((prev) => prev.map((x) => (x.repo === w.repo ? { ...x, status: "error" } : x)));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const remove = (repo: string) => {
    toggleWatch(repo);
    setRows((prev) => prev.filter((x) => x.repo !== repo));
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-[1120px] flex-col gap-8 px-4 py-8 sm:px-6">
      <SpaceBackdrop mode="scan" />
      <header className="rise" style={{ animationDelay: "0ms" }}>
        <Masthead demo={null} />
      </header>

      <section className="rise flex flex-col gap-2" style={{ animationDelay: "60ms" }}>
        <h1 className="font-display text-[clamp(1.6rem,4vw,2.6rem)] leading-tight tracking-[0.08em] text-star">
          MY CONSTELLATION
        </h1>
        <p className="max-w-[720px] text-base font-light leading-relaxed text-dim">
          The repositories you are following, with their world rank, momentum, and what changed since
          your last look. Stored only in this browser, no signup.
        </p>
      </section>

      <section className="rise flex flex-col gap-2" style={{ animationDelay: "120ms" }}>
        {ready && rows.length === 0 ? (
          <div className="hud flex flex-col gap-2 px-4 py-6 text-center">
            <p className="text-data text-dim">Your constellation is empty.</p>
            <p className="text-label text-faint">
              Open any repository and choose{" "}
              <span className="text-accent">ADD TO CONSTELLATION</span> to start following it.
            </p>
            <Link
              prefetch={false}
              href="/"
              className="numeral mx-auto mt-2 w-fit border border-accent/50 bg-accent/10 px-4 py-2 text-label tracking-[0.18em] text-accent transition-colors hover:bg-accent/20"
            >
              CHART A REPO →
            </Link>
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {rows.map((x) => {
              const dStars =
                x.status === "ranked" && x.stars !== undefined && x.lastStars !== undefined
                  ? x.stars - x.lastStars
                  : null;
              const dRank =
                x.status === "ranked" && x.rank !== undefined && x.lastRank !== undefined
                  ? x.lastRank - x.rank // positive = climbed (smaller rank number)
                  : null;
              return (
                <li key={x.repo} className="hud flex items-center gap-3 px-4 py-3">
                  <Link
                    prefetch={false}
                    href={`/r/${x.repo}`}
                    className="flex min-w-0 flex-1 flex-col gap-0.5"
                  >
                    <span className="truncate font-display text-title tracking-[0.04em] text-ink">{x.repo}</span>
                    <span className="numeral text-micro tracking-[0.12em] text-faint">
                      {x.status === "loading" && "scanning…"}
                      {x.status === "ranked" &&
                        `#${fmt(x.rank ?? 0)} worldwide · ${fmt(x.stars ?? 0)} ★${
                          x.vpd ? ` · ${fmt(x.vpd)}/day` : ""
                        }`}
                      {x.status === "unranked" && "outside the worldwide top 1000"}
                      {x.status === "error" && "could not load"}
                    </span>
                  </Link>
                  {dStars !== null || dRank !== null ? (
                    <span className="numeral shrink-0 text-right text-micro">
                      {dStars !== null && dStars !== 0 ? (
                        <span className={dStars > 0 ? "text-accent" : "text-faint"}>
                          {dStars > 0 ? "▲" : "▼"} {fmt(Math.abs(dStars))} ★
                        </span>
                      ) : null}
                      {dRank !== null && dRank !== 0 ? (
                        <span className="ml-2 text-dim">
                          rank {dRank > 0 ? "▲" : "▼"} {Math.abs(dRank)}
                        </span>
                      ) : null}
                      <span className="ml-2 block text-faint">since your last look</span>
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => remove(x.repo)}
                    aria-label={`Remove ${x.repo}`}
                    className="numeral shrink-0 border border-grid px-2 py-1 text-micro text-faint transition-colors hover:border-warn/50 hover:text-warn"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <footer className="rise flex flex-wrap items-center justify-between gap-2 pb-4 pt-2">
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          WARPCHART · the present tense of open source
        </span>
        <Link prefetch={false} href="/velocity" className="numeral text-micro text-faint hover:text-dim">
          what is rising →
        </Link>
      </footer>
    </main>
  );
}
