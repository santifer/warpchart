"use client";

// Landing search: instant matches against the bundled top 1000 (zero API
// calls), deep-space matches via /api/search (debounced, edge-cached), and
// a direct "open scan" row whenever the query looks like owner/name.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtCompact } from "@/lib/format";

export interface CatalogEntry {
  r: string;
  s: number;
  k: number; // worldwide rank
}

interface Hit {
  r: string;
  s: number;
  k: number | null;
  d?: string | null;
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export default function ExploreSearch({ catalog }: { catalog: CatalogEntry[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [deep, setDeep] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const debounce = useRef<number | null>(null);

  const local = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const starts: Hit[] = [];
    const within: Hit[] = [];
    for (const c of catalog) {
      const full = c.r.toLowerCase();
      const name = full.split("/")[1] ?? full;
      if (name.startsWith(needle) || full.startsWith(needle)) starts.push({ ...c });
      else if (full.includes(needle)) within.push({ ...c });
      if (starts.length >= 6) break;
    }
    return [...starts, ...within].slice(0, 6);
  }, [q, catalog]);

  useEffect(() => {
    if (debounce.current !== null) clearTimeout(debounce.current);
    const needle = q.trim();
    if (needle.length < 3 || local.length >= 5 || REPO_RE.test(needle)) {
      setDeep([]);
      return;
    }
    debounce.current = window.setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(needle)}`);
        const data = (await res.json()) as { items: { r: string; s: number; d: string | null }[] };
        const seen = new Set(local.map((l) => l.r.toLowerCase()));
        setDeep(
          data.items
            .filter((i) => !seen.has(i.r.toLowerCase()))
            .slice(0, 4)
            .map((i) => ({ ...i, k: null }))
        );
      } catch {
        setDeep([]);
      } finally {
        setBusy(false);
      }
    }, 350);
    return () => {
      if (debounce.current !== null) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, local.length]);

  const direct: Hit | null =
    REPO_RE.test(q.trim()) && !local.some((l) => l.r.toLowerCase() === q.trim().toLowerCase())
      ? { r: q.trim(), s: 0, k: null }
      : null;

  const rows: Hit[] = [...local, ...deep, ...(direct ? [direct] : [])];
  const clampedSel = Math.min(sel, Math.max(rows.length - 1, 0));

  const open = (r: string) => router.push(`/r/${r}`);

  return (
    <div className="relative w-full">
      <div className="hud flex items-center gap-3 px-4 py-3">
        <span className="numeral text-label tracking-[0.25em] text-accent">SCAN</span>
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter" && rows[clampedSel]) {
              open(rows[clampedSel].r);
            }
          }}
          placeholder="search any repository · react, kubernetes, owner/name…"
          className="numeral w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          aria-label="Search any GitHub repository"
        />
        {busy ? <span className="numeral shrink-0 text-micro text-faint">SCANNING…</span> : null}
      </div>

      {rows.length ? (
        <div className="hud absolute left-0 right-0 top-full z-20 mt-1 py-1">
          {rows.map((hit, i) => {
            const ownerName = hit.r.split("/")[0];
            const repoName = hit.r.split("/")[1] ?? hit.r;
            const firstDeep = hit.k === null && hit.s > 0 && rows[i - 1]?.k !== null;
            return (
              <div key={hit.r}>
                {firstDeep ? (
                  <div className="numeral border-t border-grid px-4 pb-1 pt-2 text-micro tracking-[0.3em] text-faint">
                    DEEP SPACE
                  </div>
                ) : null}
                <button
                  onMouseEnter={() => setSel(i)}
                  onClick={() => open(hit.r)}
                  className={`flex w-full items-center justify-between gap-3 border-l-2 px-4 py-2 text-left transition-colors ${
                    i === clampedSel
                      ? "border-l-accent bg-accent/10"
                      : "border-l-transparent"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {hit.s > 0 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`https://github.com/${ownerName}.png?size=44`}
                        alt=""
                        width={22}
                        height={22}
                        loading="lazy"
                        className="h-[22px] w-[22px] shrink-0 border border-grid"
                      />
                    ) : (
                      <span className="numeral flex h-[22px] w-[22px] shrink-0 items-center justify-center border border-dashed border-grid text-label text-faint">
                        ?
                      </span>
                    )}
                    <span className="numeral min-w-0 truncate text-data">
                      <span className="text-dim">{ownerName}/</span>
                      <span className="text-ink">{repoName}</span>
                      {hit.d ? (
                        <span className="ml-2 hidden text-label text-faint sm:inline">{hit.d}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className={`numeral shrink-0 text-label ${i === clampedSel ? "text-accent" : "text-dim"}`}>
                    {hit.k !== null
                      ? `#${hit.k} · ${fmtCompact(hit.s)} ★`
                      : hit.s > 0
                        ? `${fmtCompact(hit.s)} ★`
                        : "OPEN SCAN →"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
