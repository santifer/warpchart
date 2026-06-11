"use client";

// Hour-of-day x day-of-week star activity since launch (UTC).
// Color ramp runs cold to hot, theme-aware: multi-hue on purpose, because
// single-hue alpha ramps are unreadable in the mid range.
import type { DashboardBundle } from "@/lib/bundle";
import { usePalette } from "@/lib/usePalette";
import type { HeatStop } from "@/lib/theme";
import { fmt } from "@/lib/format";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function ramp(t: number, stops: HeatStop[]): string {
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].t) {
      const a = stops[i - 1];
      const b = stops[i];
      const k = (t - a.t) / (b.t - a.t);
      const mix = a.c.map((v, j) => Math.round(v + (b.c[j] - v) * k));
      return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
    }
  }
  const last = stops[stops.length - 1].c;
  return `rgb(${last[0]}, ${last[1]}, ${last[2]})`;
}

export default function Heatmap({ bundle }: { bundle: DashboardBundle }) {
  const C = usePalette();
  const matrix = bundle.heatmap;
  const max = Math.max(1, ...matrix.flat());
  const legend = `linear-gradient(90deg, ${C.heat
    .map((s) => `rgb(${s.c[0]},${s.c[1]},${s.c[2]})`)
    .join(", ")})`;

  return (
    <div className="flex flex-col gap-1.5">
      {matrix.map((row, d) => (
        <div key={d} className="flex items-center gap-1.5">
          <span className="numeral w-8 shrink-0 text-right text-micro text-faint">
            {DAYS[d]}
          </span>
          <div className="grid flex-1 grid-cols-24 gap-[3px]">
            {row.map((count, h) => (
              <div
                key={h}
                className="aspect-square min-w-0"
                title={`${DAYS[d]} ${String(h).padStart(2, "0")}:00 UTC · ${fmt(count)} stars`}
                style={{
                  background:
                    count === 0 ? C.heatZero : ramp(Math.pow(count / max, 0.75), C.heat),
                }}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-1.5">
        <span className="w-8 shrink-0" />
        <div className="grid flex-1 grid-cols-24 gap-[3px]">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="numeral text-center text-micro text-faint">
              {h % 3 === 0 ? h : ""}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="numeral text-micro text-faint">hour of day, UTC</span>
        <div className="flex items-center gap-2">
          <span className="numeral text-micro text-faint">cold</span>
          <div className="h-[6px] w-28" style={{ background: legend }} />
          <span className="numeral text-micro text-faint">hot · {fmt(max)}/h max</span>
        </div>
      </div>
    </div>
  );
}
