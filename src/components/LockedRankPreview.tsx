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

  // Reveal a fragment: the most recent ~30% is drawn SHARP (proof we already
  // hold a real record on this repo), while the older history stays blurred =
  // locked. Intrigue beats frustration.
  const cut = Math.max(0, pts.length - Math.max(2, Math.ceil(pts.length * 0.3)));
  const recent = pts.slice(cut);
  const recentLine = recent.map((p) => `${xFor(p.t).toFixed(1)},${yFor(p.rank).toFixed(1)}`).join(" ");
  const recentX0 = xFor(recent[0].t);

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
        {/* full trajectory, blurred = the locked history */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-[132px] w-full text-accent"
          style={{ filter: "blur(1.7px)", opacity: 0.6 }}
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
        </svg>

        {/* recent fragment, SHARP = the proof we already have a real record */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-[132px] w-full text-accent"
          aria-hidden
        >
          <line x1={recentX0} y1={PT - 2} x2={recentX0} y2={H - PB} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 4" />
          <polyline
            points={recentLine}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={xFor(last.t)} cy={yFor(last.rank)} r={3.4} fill="currentColor" />
        </svg>

        {/* "exact" tag near the revealed fragment */}
        <span className="numeral pointer-events-none absolute right-3 top-1 text-micro tracking-[0.15em] text-accent">
          ✓ exact · live
        </span>

        {/* unlock prompt sits over the OLDER, blurred history, not the reveal */}
        <div className="pointer-events-none absolute inset-y-0 left-0 right-[36%] flex items-center justify-center">
          <span className="numeral border border-accent/50 bg-void/75 px-3 py-1.5 text-label tracking-[0.2em] text-accent">
            ◈ UNLOCK THE FULL TRAJECTORY
          </span>
        </div>
      </div>

      <p className="mt-3 max-w-[68ch] text-data font-light leading-relaxed text-dim">
        We have been recording <span className="text-ink">{name}</span>&apos;s world rank for{" "}
        <span className="text-accent">{days} days</span>. Tracking unlocks the recorded trajectory, and
        the recording continues from here. Today&apos;s worldwide standing can only be captured today, so
        your record only deepens from the day you start.
      </p>

      {/* the whole preview is a conversion surface: clicking unlocks pricing for
          THIS repo. Without it, the strongest "we already have your data" panel
          was a dead click while every other locked panel funneled to /pricing. */}
      <a
        href={`/pricing?repo=${encodeURIComponent(repo)}`}
        className="absolute inset-0 z-20"
        aria-label={`Unlock ${name}'s full world-rank history`}
      />
    </div>
  );
}
