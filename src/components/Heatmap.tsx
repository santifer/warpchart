"use client";

// Hour-of-day x day-of-week star activity since launch (UTC).
// Color ramp runs cold to hot: dim steel blue -> cyan -> amber -> warm white.
// Multi-hue on purpose: alpha-only ramps are unreadable in the mid range on
// a near-black background.
import type { DashboardBundle } from "@/lib/bundle";
import { fmt } from "@/lib/format";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const STOPS: { t: number; c: [number, number, number] }[] = [
  { t: 0.0, c: [16, 38, 56] }, // dim steel blue
  { t: 0.35, c: [24, 132, 158] }, // deep teal
  { t: 0.62, c: [83, 214, 232] }, // accent cyan
  { t: 0.85, c: [242, 163, 60] }, // amber
  { t: 1.0, c: [255, 233, 196] }, // warm white
];

function ramp(t: number): string {
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i].t) {
      const a = STOPS[i - 1];
      const b = STOPS[i];
      const k = (t - a.t) / (b.t - a.t);
      const mix = a.c.map((v, j) => Math.round(v + (b.c[j] - v) * k));
      return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
    }
  }
  return "rgb(255, 233, 196)";
}

export default function Heatmap({ bundle }: { bundle: DashboardBundle }) {
  const matrix = bundle.heatmap;
  const max = Math.max(1, ...matrix.flat());

  return (
    <div className="flex flex-col gap-1.5">
      {matrix.map((row, d) => (
        <div key={d} className="flex items-center gap-1.5">
          <span className="numeral w-8 shrink-0 text-right text-[9px] text-faint">
            {DAYS[d]}
          </span>
          <div className="grid flex-1 grid-cols-24 gap-[3px]">
            {row.map((count, h) => (
              <div
                key={h}
                className="aspect-square min-w-0"
                title={`${DAYS[d]} ${String(h).padStart(2, "0")}:00 UTC · ${fmt(count)} stars`}
                style={{
                  background: count === 0 ? "rgba(83, 214, 232, 0.04)" : ramp(Math.pow(count / max, 0.75)),
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
            <span key={h} className="numeral text-center text-[8px] text-faint">
              {h % 3 === 0 ? h : ""}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="numeral text-[9px] text-faint">hour of day, UTC</span>
        <div className="flex items-center gap-2">
          <span className="numeral text-[9px] text-faint">cold</span>
          <div
            className="h-[6px] w-28"
            style={{
              background:
                "linear-gradient(90deg, rgb(16,38,56), rgb(24,132,158), rgb(83,214,232), rgb(242,163,60), rgb(255,233,196))",
            }}
          />
          <span className="numeral text-[9px] text-faint">hot · {fmt(max)}/h max</span>
        </div>
      </div>
    </div>
  );
}
