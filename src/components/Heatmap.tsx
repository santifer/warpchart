"use client";

// Hour-of-day x day-of-week star activity since launch (UTC).
import type { DashboardBundle } from "@/lib/bundle";
import { fmt } from "@/lib/format";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

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
            {row.map((count, h) => {
              const a = count === 0 ? 0.04 : 0.07 + 0.88 * Math.pow(count / max, 1.5);
              return (
                <div
                  key={h}
                  className="aspect-square min-w-0"
                  title={`${DAYS[d]} ${String(h).padStart(2, "0")}:00 UTC · ${fmt(count)} stars`}
                  style={{ background: `rgba(83, 214, 232, ${a.toFixed(3)})` }}
                />
              );
            })}
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
      <p className="numeral mt-1 text-right text-[9px] text-faint">hour of day, UTC</p>
    </div>
  );
}
