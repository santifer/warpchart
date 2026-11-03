"use client";

import { useEffect, useRef, useState } from "react";

import type { MissionEvent } from "@/lib/types";

const GLYPH: Record<MissionEvent["kind"], { g: string; cls: string }> = {
  gate: { g: "◆", cls: "text-accent" },
  overtake: { g: "▸", cls: "text-ink" },
  record: { g: "★", cls: "text-warn" },
  online: { g: "●", cls: "text-faint" },
  // a spike is good news: accent, not the alert orange
  spike: { g: "◈", cls: "text-accent" },
};

function fmtTs(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export default function MissionLog({
  events,
  captain,
  fillHeight = false,
}: {
  events: MissionEvent[];
  captain: string | null;
  // Command Deck: as many columns as the height needs (rows = height / line),
  // so the log fills its panel top to bottom instead of leaving the bottom
  // empty and squeezing names into narrow columns
  fillHeight?: boolean;
}) {
  const reversed = [...events].reverse();
  const listRef = useRef<HTMLUListElement | null>(null);
  const [cols, setCols] = useState(1);
  const [cap, setCap] = useState<number | null>(null);
  useEffect(() => {
    const el = listRef.current;
    if (!fillHeight || !el) return;
    const fit = () => {
      const li = el.querySelector("li");
      const line = li ? li.getBoundingClientRect().height + 6 : 26;
      const rows = Math.max(1, Math.floor(el.clientHeight / line));
      // never narrower than ~26rem a column: past that the names truncate,
      // so a short screen shows fewer entries (the fade marks the cut)
      // a line needs ~36rem to keep its name whole; only full columns are
      // shown (the newest columns x rows events), so no column is an orphan
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const maxCols = Math.max(1, Math.floor(el.clientWidth / (36 * rem)));
      const next = Math.min(maxCols, Math.max(1, Math.ceil(reversed.length / rows)));
      const nextCap = next > 1 ? Math.min(reversed.length, next * rows) : null;
      setCols((c) => (c === next ? c : next));
      setCap((c) => (c === nextCap ? c : nextCap));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fillHeight, reversed.length]);
  return (
    <div className="flex flex-col gap-3">
      {captain ? (
        <p className="numeral border-l-2 border-accent/50 pl-3 text-data leading-relaxed text-ink">
          {captain}
        </p>
      ) : null}
      {reversed.length ? (
        <ul
          ref={listRef}
          className="mission-log-list flex flex-col gap-1.5"
          style={fillHeight ? { columnCount: cols } : undefined}
        >
          {(fillHeight && cap ? reversed.slice(0, cap) : reversed).map((e, i) => (
            <li key={`${e.ts}-${i}`} className="numeral flex min-w-0 items-baseline gap-3 text-data">
              <span className={`shrink-0 ${GLYPH[e.kind].cls}`}>{GLYPH[e.kind].g}</span>
              <span className="shrink-0 text-faint" suppressHydrationWarning>{fmtTs(e.ts)}</span>
              {e.url ? (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate text-dim underline decoration-grid underline-offset-4 transition-colors hover:text-ink"
                >
                  {e.text}
                </a>
              ) : (
                (() => {
                  // the figure in parentheses stays whole; the name truncates
                  const m = e.text.match(/^(.*?)(\s\([^()]*\))$/);
                  return m ? (
                    <span className="flex min-w-0 text-dim" title={e.text}>
                      <span className="min-w-0 truncate">{m[1]}</span>
                      <span className="shrink-0 whitespace-pre">{m[2]}</span>
                    </span>
                  ) : (
                    <span className="min-w-0 truncate text-dim" title={e.text}>{e.text}</span>
                  );
                })()
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="numeral text-label text-faint">
          no events yet. The log fills itself as history accumulates: milestone
          gates, overtakes, daily records.
        </p>
      )}
    </div>
  );
}
