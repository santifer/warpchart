"use client";

// Mobile star chart: a vertical ascent (subway-map pattern). The galactic
// core sits at the top, our ship below the ships we still have to pass,
// milestone gates as separators. Full-width rows never collide; tapping a
// row pins it (dashboard) or warps to it (explorer); the chevron always
// opens that repo's scan page.
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ChartInputs } from "@/lib/types";
import { fmt, fmtCompact, fmtEtaDays, shortName } from "@/lib/format";
import { neighborEtas, type NeighborEta } from "@/lib/projections";

type Row =
  | { kind: "core" }
  | { kind: "void"; count: number }
  | { kind: "gate"; rank: number; threshold: number }
  | { kind: "ship"; n: NeighborEta }
  | { kind: "me" };

function trunc(s: string): string {
  return s.length > 22 ? s.slice(0, 21) + "…" : s;
}

export default function VerticalChart({
  inputs,
  target = null,
  onPinTarget,
}: {
  inputs: ChartInputs;
  target?: string | null;
  onPinTarget?: (r: string | null) => void;
}) {
  const router = useRouter();
  const { stars, rank, v7d: vOwn, apex } = inputs;
  const etas = neighborEtas(inputs.neighbors, stars, vOwn);
  const ahead = etas.filter((n) => n.gap > 0).sort((a, b) => a.gap - b.gap).slice(0, 10);
  const behind = etas.filter((n) => n.gap <= 0).sort((a, b) => b.gap - a.gap).slice(0, 3);

  // Everything above us, ordered by stars descending (top = closer to #1).
  const above: Row[] = [
    ...inputs.milestones.map((m) => ({ kind: "gate" as const, rank: m.rank, threshold: m.threshold })),
    ...ahead.map((n) => ({ kind: "ship" as const, n })),
  ].sort((a, b) => {
    const sa = a.kind === "gate" ? a.threshold : a.n.s;
    const sb = b.kind === "gate" ? b.threshold : b.n.s;
    return sb - sa;
  });

  const hiddenAbove = apex && rank ? Math.max(0, rank - inputs.milestones.length - ahead.length - 2) : 0;
  const rows: Row[] = [
    { kind: "core" },
    ...(hiddenAbove > 0 ? [{ kind: "void" as const, count: hiddenAbove }] : []),
    ...above,
    { kind: "me" },
    ...behind.map((n) => ({ kind: "ship" as const, n })),
  ];

  const act = (r: string) => {
    if (onPinTarget) onPinTarget(target === r ? null : r);
    else router.push(`/r/${r}#from=${encodeURIComponent(inputs.repo)}`);
  };

  return (
    <ol className="relative ml-2 flex flex-col border-l border-grid">
      {rows.map((row, i) => {
        if (row.kind === "core") {
          return (
            <li key="core" className="relative py-3 pl-5">
              <span className="core-glow absolute -left-[7px] top-1/2 block h-[13px] w-[13px] -translate-y-1/2 rounded-full bg-star" />
              <div className="numeral text-data font-semibold text-star">
                GALACTIC CORE {apex ? `· #1 ${trunc(shortName(apex.r))}` : ""}
              </div>
              {apex ? (
                <div className="numeral text-label text-dim">{fmt(apex.s)} ★</div>
              ) : null}
            </li>
          );
        }
        if (row.kind === "void") {
          return (
            <li key={`void-${i}`} className="relative py-2 pl-5">
              <span className="absolute -left-[3px] top-1/2 block h-[5px] w-[5px] -translate-y-1/2 rounded-full bg-faint opacity-50" />
              <div className="numeral text-micro tracking-[0.15em] text-faint">
                ··· {fmt(row.count)} systems between ···
              </div>
            </li>
          );
        }
        if (row.kind === "gate") {
          return (
            <li key={`gate-${row.rank}`} className="relative py-2.5 pl-5">
              <span className="absolute -left-[6px] top-1/2 block h-[11px] w-[11px] -translate-y-1/2 rounded-full border border-accent bg-void" />
              <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-accent/30 pb-1">
                <span className="numeral text-label tracking-[0.2em] text-accent">
                  TOP {row.rank} GATE
                </span>
                <span className="numeral text-label text-dim">{fmt(row.threshold)} ★</span>
              </div>
            </li>
          );
        }
        if (row.kind === "me") {
          return (
            <li key="me" className="relative py-3 pl-5">
              <span className="absolute -left-[7px] top-1/2 -translate-y-1/2 text-accent" aria-hidden>
                ▲
              </span>
              <div className="numeral text-data font-bold text-star">{shortName(inputs.repo)}</div>
              <div className="numeral text-label text-accent">
                {fmt(stars)} ★{rank ? ` · #${fmt(rank)}` : ""} · {fmt(Math.round(vOwn))}/day
              </div>
            </li>
          );
        }
        const n = row.n;
        const isAhead = n.gap > 0;
        const statusColor = !isAhead ? "text-faint" : n.receding ? "text-warn" : "text-accent";
        const isTarget = target === n.r;
        return (
          <li key={n.r} className="relative py-2 pl-5">
            <span
              className={`absolute -left-[5px] top-1/2 block h-[9px] w-[9px] -translate-y-1/2 rounded-full ${
                isTarget ? "ring-1 ring-accent ring-offset-2 ring-offset-void" : ""
              } ${!isAhead ? "bg-faint" : n.receding ? "bg-warn" : "bg-accent"}`}
            />
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => act(n.r)} className="min-w-0 flex-1 text-left">
                <div className="numeral truncate text-data text-ink">{trunc(shortName(n.r))}</div>
                <div className="numeral text-label text-dim">
                  {fmt(n.s)} ★ · {isAhead ? `+${fmt(n.gap)}` : `${fmt(n.gap)}`} · {Math.round(n.v)}/d
                  {" · "}
                  <span className={statusColor}>
                    {!isAhead ? "passed" : n.receding ? "receding" : `eta ${fmtEtaDays(n.etaDays)}`}
                  </span>
                </div>
              </button>
              <Link
                href={`/r/${n.r}#from=${encodeURIComponent(inputs.repo)}`}
                className="numeral shrink-0 border border-grid px-2 py-1 text-label text-dim transition-colors hover:text-ink"
                aria-label={`Open ${n.r}`}
              >
                →
              </Link>
            </div>
          </li>
        );
      })}
      <li className="relative pl-5 pt-2">
        <span className="numeral text-micro text-faint">
          ascent view · {fmtCompact(stars)} of {apex ? fmtCompact(apex.s) : "?"} ★ to the core
        </span>
      </li>
    </ol>
  );
}
