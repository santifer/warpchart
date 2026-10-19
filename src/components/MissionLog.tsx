"use client";

import type { MissionEvent } from "@/lib/types";
import { fmtUtcStamp } from "@/lib/format";

const GLYPH: Record<MissionEvent["kind"], { g: string; cls: string }> = {
  gate: { g: "◆", cls: "text-accent" },
  overtake: { g: "▸", cls: "text-ink" },
  record: { g: "★", cls: "text-warn" },
  online: { g: "●", cls: "text-faint" },
  spike: { g: "◈", cls: "text-warn" },
};

export default function MissionLog({
  events,
  captain,
}: {
  events: MissionEvent[];
  captain: string | null;
}) {
  const reversed = [...events].reverse();
  return (
    <div className="flex flex-col gap-3">
      {captain ? (
        <p className="numeral border-l-2 border-accent/50 pl-3 text-data leading-relaxed text-ink">
          {captain}
        </p>
      ) : null}
      {reversed.length ? (
        <ul className="flex flex-col gap-1.5">
          {reversed.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="numeral flex items-baseline gap-3 text-data">
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
                  className="text-dim underline decoration-grid underline-offset-4 transition-colors hover:text-ink"
                >
                  {e.text}
                </a>
              ) : (
                <span className="text-dim">{e.text}</span>
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
