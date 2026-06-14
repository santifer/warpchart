// The "locked treasure": a blurred, REAL preview of a repo's world-rank
// trajectory, drawn from the accumulated route-history index. The data already
// exists; the visitor only unlocks it. Far stronger than "we'll start charting
// now". Server component, pure SVG (no client JS). Renders nothing until at
// least two days have been recorded, so it degrades gracefully on fresh repos.
import { repoRankTrajectory } from "@/lib/rank-history";

const W = 600;
const H = 132;
const PL = 10;
const PR = 10;
const PT = 14;
const PB = 20;

export default async function LockedRankPreview({ repo, name }: { repo: string; name: string }) {
  const pts = await repoRankTrajectory(repo).catch(() => []);
  if (pts.length < 2) return null;

  const tMin = pts[0].t;
  const tMax = pts[pts.length - 1].t;
  const ranks = pts.map((p) => p.rank);
  const rankMin = Math.min(...ranks); // best (drawn at the top)
  const rankMax = Math.max(...ranks);
  const tSpan = Math.max(1, tMax - tMin);
  const rSpan = Math.max(1, rankMax - rankMin);
  const days = Math.max(1, Math.round(tSpan / 86_400_000) + 1);

  const xFor = (t: number) => PL + ((t - tMin) / tSpan) * (W - PL - PR);
  const yFor = (rank: number) => PT + ((rank - rankMin) / rSpan) * (H - PT - PB);

  const line = pts.map((p) => `${xFor(p.t).toFixed(1)},${yFor(p.rank).toFixed(1)}`).join(" ");
  const area =
    `${PL},${H - PB} ` + line + ` ${(W - PR).toFixed(1)},${H - PB}`;
  const last = pts[pts.length - 1];
  const best = `#${rankMin}`;

  return (
    <div className="hud relative overflow-hidden px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="numeral text-label tracking-[0.2em] text-accent">
          ◈ ALREADY CHARTED · {name.toUpperCase()}&apos;S WORLD RANK
        </span>
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          {days} days on record · best {best}
        </span>
      </div>

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-[132px] w-full text-accent"
          style={{ filter: "blur(1.7px)", opacity: 0.72 }}
          aria-hidden
        >
          <polygon points={area} fill="currentColor" fillOpacity={0.07} />
          <polyline
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={xFor(last.t)} cy={yFor(last.rank)} r={3} fill="currentColor" />
        </svg>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="numeral border border-accent/50 bg-void/75 px-3 py-1.5 text-label tracking-[0.2em] text-accent">
            ◈ UNLOCK {name.toUpperCase()}&apos;S TRAJECTORY
          </span>
        </div>
      </div>

      <p className="mt-3 max-w-[68ch] text-data font-light leading-relaxed text-dim">
        We have been recording <span className="text-ink">{name}</span>&apos;s world rank for{" "}
        <span className="text-accent">{days} days</span>. Tracking unlocks every point, keeps every
        day from here, and you never lose another. This is the one thing that cannot be backfilled.
      </p>
    </div>
  );
}
