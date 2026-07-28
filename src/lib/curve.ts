// Shared cumulative-curve builder: the SVG embed and the JSON endpoint for
// the interactive page chart read the SAME cached reconstruction, so a
// visit warms the embed and vice versa.
import { unstable_cache } from "next/cache";
import { loadTimestamps, loadMeta, lastSnapshot } from "@/lib/history";
import { repoBasic, stargazerPageFirst, lowFuel } from "@/lib/github";
import { repoRankTrajectory } from "@/lib/rank-history";
import { reqLog } from "@/lib/log";

export interface Curve {
  repo: string;
  total: number;
  pts: { t: number; v: number }[];
  // points from this index on are extrapolated (REST caps stargazer
  // pagination at 40K stars), rendered as a dashed/estimated tail. When an
  // exact-recent tail exists (exactFrom), the dashed stretch is the BOUNDED
  // middle [dashedFrom, exactFrom], not an open tail to "now".
  dashedFrom: number | null;
  // points from this index on come from the public event archive
  // (GH Archive via OSS Insight, anchored between two exact values): REAL
  // monthly history beyond the API cap, rendered solid with a seam label
  archiveFrom?: number | null;
  // points from this index on are EXACT daily stars from our own rank-history
  // record (top-10k worldwide snapshot, collector/route-history.mjs). This is
  // the recent window every shared view emphasizes, and it has no per-share
  // cost: the data is already collected daily for the rank moat. Rendered
  // solid; also marks the END of any estimated/archive middle band.
  exactFrom?: number | null;
  // true when no per-star source was reachable and the shape is a floor
  // (creation -> now) rather than a reconstruction. Callers cache these for
  // minutes, not hours, so a repo recovers as soon as a real source returns.
  degraded?: boolean;
}

// Place an archive's MONTHLY shape between two EXACT anchor points, rescaled so
// the cumulative leaves `start` and arrives exactly at `end`. Anchoring BOTH
// ends (not just the far one) cancels the velocity step the archive's burst-
// undercounting leaves at a seam, and bounds its error to the interval between
// two known truths. Returns only the strictly-interior months.
function anchorArchiveBetween(
  archive: { t: number; total: number }[],
  start: { t: number; v: number },
  end: { t: number; v: number }
): { t: number; v: number }[] {
  if (!archive.length || end.t <= start.t) return [];
  const archAt = (tt: number) => {
    if (tt <= archive[0].t) return 0;
    const i = archive.findIndex((m) => m.t > tt);
    if (i === -1) return archive[archive.length - 1].total;
    if (i === 0) return 0;
    const a = archive[i - 1];
    const b = archive[i];
    return a.total + ((b.total - a.total) * (tt - a.t)) / Math.max(1, b.t - a.t);
  };
  const aStart = archAt(start.t);
  const span = archAt(end.t) - aStart;
  if (span <= 0) return [];
  const k = (end.v - start.v) / span;
  return archive
    .filter((m) => m.t > start.t && m.t < end.t)
    .map((m) => ({ t: m.t, v: Math.round(start.v + (archAt(m.t) - aStart) * k) }))
    .filter((m) => m.v > start.v && m.v < end.v);
}

// Monthly cumulative stars from the public event archive, by repo id (so
// renames do not split history). The archive undercounts recent viral
// repos (GitHub suppresses public WatchEvents in bursts, verified jun-26:
// career-ops 8K archived vs 52K real), so callers MUST validate coverage
// before trusting it.
async function fetchArchiveMonthlyRaw(repoId: number): Promise<{ t: number; total: number }[]> {
  const res = await fetch(
    `https://api.ossinsight.io/q/analyze-stars-history?repoId=${repoId}`,
    { headers: { "User-Agent": "warpchart" }, signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) throw new Error(`ossinsight ${res.status}`);
  const body = (await res.json()) as { data?: { event_month: string; total: number }[] };
  const rows = body.data ?? [];
  // throwing keeps failures and empty answers OUT of the 30-day cache, so
  // they retry on the next curve rebuild instead of sticking for a month
  if (!rows.length) throw new Error("ossinsight empty");
  return rows
    .map((r) => ({ t: Date.parse(r.event_month), total: r.total }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);
}

// Monthly archive history is immutable (only the current month moves, and
// the both-ends normalization absorbs that), so cache it for 30 days: one
// third-party call per repo per month instead of one per curve rebuild,
// and an OSS Insight outage stops mattering for already-seen repos.
async function fetchArchiveMonthly(repoId: number): Promise<{ t: number; total: number }[] | null> {
  try {
    return await unstable_cache(fetchArchiveMonthlyRaw, ["archive-monthly-v1"], {
      revalidate: 30 * 86_400,
      tags: [`archive:${repoId}`],
    })(repoId);
  } catch {
    return null;
  }
}

// Spaced stargazer pages, the same reconstruction star-history uses (they hide
// the estimated stretch; we label it). Returns [] when the list is unavailable
// instead of throwing: since GitHub closed third-party stargazer listing (jun-26)
// this is a BONUS source for repos we own, not the backbone of the curve.
async function restSample(owner: string, name: string, stars: number, repo: string) {
  // a cold sample costs ~24 REST calls; when the fuel is nearly gone the edge
  // keeps serving stale copies and cold repos wait for the reset
  if (lowFuel()) return [];
  // One cheap probe first. Listing another account's stargazers now 404s on
  // every page (verified 2026-07-27: own repos at 10 and 61.8K stars list fine,
  // foreign repos at 389 and 246K stars 404 alike, so it is permission, not
  // size). Probing costs 1 call instead of burning 24 on a certain failure —
  // and it self-heals the day GitHub reopens the endpoint.
  const probe = await stargazerPageFirst(owner, name, 1).catch(() => null);
  if (!probe) return [];

  const reachable = Math.min(stars, 40_000);
  const totalPages = Math.max(1, Math.ceil(reachable / 100));
  const SAMPLES = Math.min(24, totalPages);
  const pages = new Set<number>([1]);
  for (let i = 0; i < SAMPLES; i++)
    pages.add(Math.max(1, Math.round(1 + (i * (totalPages - 1)) / Math.max(SAMPLES - 1, 1))));
  const sorted = [...pages].sort((a, b) => a - b);
  const samples = await Promise.all(
    sorted.map(async (p) => ({
      p,
      at: p === 1 ? probe : await stargazerPageFirst(owner, name, p).catch(() => null),
    }))
  );
  const failed = samples.filter((s) => !s.at).length;
  if (failed > 0) {
    reqLog("curve", { repo }).warn("sample.pages-failed", { failed, asked: sorted.length });
  }
  return samples
    .filter((s) => s.at)
    .map((s) => ({ t: Date.parse(s.at as string), v: (s.p - 1) * 100 + 1 }))
    .sort((a, b) => a.t - b.t);
}

// Curve for an arbitrary repo. Cascade, most authoritative first, and it only
// throws when the repo itself is gone: a chart that degrades is worth more than
// a 502. Sources, in order:
//   1. REST stargazer sampling  - exact per-star history, own repos only now
//   2. our own rank-history     - exact DAILY stars for the worldwide top-10k,
//                                 free (already collected for the rank moat)
//   3. the public event archive - monthly shape for the deep past, non-fatal
//   4. a two-point floor        - creation -> now, dashed and marked degraded
async function sampleCurve(owner: string, name: string): Promise<Curve> {
  const basic = await repoBasic(owner, name);
  const log = reqLog("curve", { repo: basic.r });
  const pts = await restSample(owner, name, basic.s, basic.r);

  // ---- Tail reconstruction: the most authoritative source per era ----
  //   [0 .. cap]            exact REST stargazer timestamps (truth, <=40K)
  //   [cap .. exactFrom)    the unobservable middle: GH Archive shape anchored
  //                         at BOTH ends to exact values, else a marked estimate
  //   [exactFrom .. end]    exact DAILY stars from our own rank-history record
  let dashedFrom: number | null = null;
  let archiveFrom: number | null = null;
  let exactFrom: number | null = null;
  let degraded = false;

  const restLast = pts.length ? pts[pts.length - 1] : null;
  if (!restLast || basic.s > restLast.v) {
    // Exact daily stars we recorded ourselves, above whatever REST reached and
    // within the live total (defensive against unstars / late corrections).
    // Free: already collected daily for the worldwide-rank moat, zero GitHub
    // cost, and for a foreign repo it is now the ONLY per-day source there is.
    const traj = await repoRankTrajectory(basic.r).catch(() => []);
    const exactRecent = traj
      .filter((p) => (!restLast || p.t > restLast.t) && p.stars > (restLast?.v ?? 0))
      .filter((p) => p.stars <= basic.s + 50)
      .map((p) => ({ t: p.t, v: p.stars }));

    // Where the exact part ends. With no REST sample the repo's creation (zero
    // stars) is the only anchor we can honestly claim.
    const lastExact = restLast ?? { t: Date.parse(basic.created), v: 0 };
    if (!restLast) pts.push(lastExact);

    if (exactRecent.length >= 2) {
      // We own the recent window exactly. Only the middle between the REST cap
      // and the first recorded day is unobserved; fill it the best we can.
      const recStart = exactRecent[0];
      const gapDays = (recStart.t - lastExact.t) / 86_400_000;
      const gapStars = recStart.v - lastExact.v;
      let middle: { t: number; v: number }[] = [];
      let middleEstimated = false;
      if (gapDays > 45 && gapStars > 0) {
        // a substantial unknown middle: prefer real archive SHAPE, bounded by
        // the two exact anchors; a straight dashed ramp only if the archive is
        // unavailable for this repo
        const archive = await fetchArchiveMonthly(basic.id);
        middle = archive ? anchorArchiveBetween(archive, lastExact, recStart) : [];
        if (middle.length) archiveFrom = pts.length - 1;
        else middleEstimated = true;
      }
      if (middleEstimated) dashedFrom = pts.length - 1;
      pts.push(...middle, ...exactRecent);
      exactFrom = pts.length - exactRecent.length;
      // carry the last recorded day up to the live count if it grew since
      if (basic.s > pts[pts.length - 1].v) pts.push({ t: Date.now(), v: basic.s });
      log.info("exact-recent.spliced", {
        days: exactRecent.length, middle: middle.length,
        middleEstimated, gapDays: Math.round(gapDays),
      });
    } else {
      // No recorded window for this repo (outside the top 10k, or nothing
      // recorded yet): fall back to the archive-to-now / dashed-to-now
      // reconstruction. Coverage check: the archive misses suppressed viral
      // bursts, so require it to account for >=85% of live stars before trust.
      const archive = await fetchArchiveMonthly(basic.id);
      const archiveTotal = archive?.[archive.length - 1]?.total ?? 0;
      const reliable = archive !== null && archiveTotal >= basic.s * 0.85;
      let stitched = false;
      if (reliable && archive) {
        const middle = anchorArchiveBetween(archive, lastExact, { t: Date.now(), v: basic.s });
        if (middle.length) {
          archiveFrom = pts.length - 1;
          pts.push(...middle, { t: Date.now(), v: basic.s });
          stitched = true;
          log.info("archive.used", { months: middle.length, archiveTotal });
        }
      }
      if (!stitched) {
        dashedFrom = pts.length - 1;
        pts.push({ t: Date.now(), v: basic.s });
        // No per-star source at all: this is the honest floor (it went from 0
        // at creation to today's count), not a reconstruction. Flagged so it
        // is cached for minutes and recovers as soon as a source returns.
        degraded = !restLast;
        log.info("archive.skipped", { archiveTotal, live: basic.s, reliable, degraded });
      }
    }
  }
  return { repo: basic.r, total: basic.s, pts, dashedFrom, archiveFrom, exactFrom, degraded };
}

// Version of the curve reconstruction. Bump on ANY change to the data shape
// (sampling, normalization, stitching): the bump purges every cached curve
// on its next request, so pre-fix curves never linger out their TTL.
// v2: seam-anchored archive normalization. v3: per-repo tags + live total.
// v4: exact daily recent tail spliced from the rank-history moat.
// v5: cascade that never 502s (REST stargazer listing closed for foreign repos).
// v6: daily points clamped to now, so a curve built in the morning no longer
// carries today's noon-stamped point as a future timestamp.
const CURVE_VERSION = 6;

export function curveTag(owner: string, name: string): string {
  return `curve:${owner.toLowerCase()}/${name.toLowerCase()}`;
}

// Cached for 6h, degraded curves included: a repo outside the worldwide top-10k
// has no per-day source at all, so its floor is a STABLE answer, not a transient
// failure to retry. Re-deriving it per visit would multiply cost without ever
// improving the shape. The rank collector adds repos to the moat daily, and the
// version bump purges everything when the reconstruction itself changes.
export function cachedSampleCurve(owner: string, name: string): Promise<Curve> {
  return unstable_cache(sampleCurve, [`embed-chart-curve-v${CURVE_VERSION}`], {
    revalidate: 21_600,
    tags: [curveTag(owner, name)],
  })(owner, name);
}

// Overlay the LIVE star total on a cached curve: the SHAPE can be hours old
// (expensive to rebuild), but the header counter and the endpoint always
// match GitHub right now, at the cost of one REST call per edge-cache miss.
export async function withLiveTotal(curve: Curve, owner: string, name: string): Promise<Curve> {
  if (lowFuel()) return curve; // cached totals are fine when fuel is short
  try {
    const basic = await repoBasic(owner, name);
    const pts = [...curve.pts];
    const last = pts[pts.length - 1];
    // An exact-recent tail is REAL data: extend it with a fresh live point
    // (append, don't overwrite the last recorded day). Only a purely synthetic
    // tail (dashed/archive ending at "now") gets its endpoint overwritten.
    const exactTail = (curve.exactFrom ?? null) !== null;
    const syntheticTail =
      !exactTail && (curve.dashedFrom !== null || (curve.archiveFrom ?? null) !== null);
    if (syntheticTail && basic.s >= last.v) {
      pts[pts.length - 1] = { t: Date.now(), v: basic.s };
      return { ...curve, total: basic.s, pts };
    }
    if (!syntheticTail && basic.s > last.v) {
      pts.push({ t: Date.now(), v: basic.s });
      return { ...curve, total: basic.s, pts };
    }
  } catch {
    // cached totals are an acceptable fallback
  }
  return curve;
}

// Exact curve for the tracked tenant, straight from the local archive.
export function tenantCurve(maxPts = 140): Curve | null {
  const timestamps = loadTimestamps();
  const meta = loadMeta();
  if (!timestamps.length || !meta) return null;
  const n = timestamps.length;
  const step = Math.max(1, Math.floor(n / maxPts));
  const pts: { t: number; v: number }[] = [];
  for (let i = 0; i < n; i += step) pts.push({ t: Date.parse(timestamps[i]), v: i + 1 });
  pts.push({ t: Date.parse(timestamps[n - 1]), v: n });
  return { repo: meta.repo, total: lastSnapshot()?.stars ?? n, pts, dashedFrom: null, archiveFrom: null };
}

export function isTenantRepo(repo: string): boolean {
  const meta = loadMeta();
  return !!meta && meta.repo.toLowerCase() === repo.toLowerCase();
}

// Rough stars/day from the tail of an already-sampled curve: free velocity
// for repos outside the registry (feeds the embeds' adaptive cache TTL).
export function curveTailV(curve: Curve): number | null {
  const pts = curve.pts;
  if (pts.length < 2) return null;
  const t1 = pts[pts.length - 1].t;
  const cutoff = t1 - 14 * 86_400_000;
  let i = pts.length - 2;
  while (i > 0 && pts[i].t > cutoff) i--;
  const days = (t1 - pts[i].t) / 86_400_000;
  if (days < 0.5) return null;
  return (pts[pts.length - 1].v - pts[i].v) / days;
}
