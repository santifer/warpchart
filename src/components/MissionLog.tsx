"use client";

import { useEffect, useRef, useState } from "react";

import type { MissionEvent } from "@/lib/types";
import { fmtUtcStamp } from "@/lib/format";

const GLYPH: Record<MissionEvent["kind"], { g: string; cls: string }> = {
  gate: { g: "◆", cls: "text-accent" },
  overtake: { g: "▸", cls: "text-ink" },
  record: { g: "★", cls: "text-warn" },
  online: { g: "●", cls: "text-faint" },
  // a spike is good news: accent, not the alert orange
  spike: { g: "◈", cls: "text-accent" },
};

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
      // rect units (wall-zoomed px): the 6 px row gap is zoomed too
      const zoom = el.clientWidth > 0 ? el.getBoundingClientRect().width / el.clientWidth : 1;
      const line = li ? li.getBoundingClientRect().height + 6 * zoom : 26 * zoom;
      // the height the PANEL leaves for the list, not the list's own height
      // (that one depends on the column count and fed back into it). Both
      // rects are in the same units, so the wall zoom cancels out.
      const panel = el.closest("section");
      // measured to the panel body's real content edge (its bottom padding
      // read, not assumed: a guessed 10 px let a 14th row be laid out that
      // the clip then hid); the last row needs no trailing gap
      const body = panel?.lastElementChild as HTMLElement | null;
      const avail = body
        ? body.getBoundingClientRect().bottom -
          (parseFloat(getComputedStyle(body).paddingBottom) || 0) * zoom -
          el.getBoundingClientRect().top
        : el.clientHeight;
      const rows = Math.max(1, Math.floor((avail + 6 * zoom) / line));
      // never narrower than ~26rem a column: past that the names truncate,
      // so a short screen shows fewer entries (the fade marks the cut)
      // a line needs ~36rem to keep its name whole; only full columns are
      // shown (the newest columns x rows events), so no column is an orphan
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const maxCols = Math.max(1, Math.floor(el.clientWidth / (36 * rem)));
      // only full columns: with fewer events than slots (60 for 4 x 19 at
      // 3440) one column fewer, wider, instead of a 3-entry orphan
      const next = Math.min(maxCols, Math.max(1, Math.floor(reversed.length / rows)));
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
              {/* UTC: day-level events are stamped on the UTC day (a record at
                  23:59:59Z), which the viewer's zone moved to the next day
                  east of Greenwich, and server and client disagreed */}
              <span className="shrink-0 text-faint">{fmtUtcStamp(e.ts)}</span>
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
