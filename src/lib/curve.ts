// Shared cumulative-curve builder: the SVG embed and the JSON endpoint for
// the interactive page chart read the SAME cached reconstruction, so a
// visit warms the embed and vice versa.
import { unstable_cache } from "next/cache";
import { loadTimestamps, loadMeta, lastSnapshot } from "@/lib/history";
import { repoBasic, stargazerPageFirst } from "@/lib/github";
import { reqLog } from "@/lib/log";

export interface Curve {
  repo: string;
  total: number;
  pts: { t: number; v: number }[];
  // points from this index on are extrapolated (REST caps stargazer
  // pagination at 40K stars), rendered as a dashed/estimated tail
  dashedFrom: number | null;
  // points from this index on come from the public event archive
  // (GH Archive via OSS Insight, normalized to the live total): REAL
  // monthly history beyond the API cap, rendered solid with a seam label
  archiveFrom?: number | null;
}

// Monthly cumulative stars from the public event archive, by repo id (so
// renames do not split history). The archive undercounts recent viral
// repos (GitHub suppresses public WatchEvents in bursts, verified jun-26:
// career-ops 8K archived vs 52K real), so callers MUST validate coverage
// before trusting it.
async function fetchArchiveMonthly(
  repoId: number
): Promise<{ t: number; total: number }[] | null> {
  try {
    const res = await fetch(
      `https://api.ossinsight.io/q/analyze-stars-history?repoId=${repoId}`,
      { headers: { "User-Agent": "warpchart" } }
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { event_month: string; total: number }[] };
    const rows = body.data ?? [];
    if (!rows.length) return null;
    return rows
      .map((r) => ({ t: Date.parse(r.event_month), total: r.total }))
      .filter((r) => Number.isFinite(r.t))
      .sort((a, b) => a.t - b.t);
  } catch {
    return null;
  }
}

// Sampled curve for arbitrary repos: spaced stargazer pages, the same
// reconstruction star-history uses (they hide the estimated stretch; we
// label it). 24 samples give the interactive chart a decent shape.
async function sampleCurve(owner: string, name: string): Promise<Curve> {
  const basic = await repoBasic(owner, name);
  const reachable = Math.min(basic.s, 40_000);
  const totalPages = Math.max(1, Math.ceil(reachable / 100));
  const SAMPLES = Math.min(24, totalPages);
  const pages = new Set<number>();
  for (let i = 0; i < SAMPLES; i++)
    pages.add(Math.max(1, Math.round(1 + (i * (totalPages - 1)) / Math.max(SAMPLES - 1, 1))));
  const sorted = [...pages].sort((a, b) => a - b);
  const samples = await Promise.all(
    sorted.map(async (p) => ({
      p,
      at: await stargazerPageFirst(owner, name, p).catch(() => null),
    }))
  );
  const failed = samples.filter((s) => !s.at).length;
  if (failed > 0) {
    reqLog("curve", { repo: basic.r }).warn("sample.pages-failed", { failed, asked: sorted.length });
  }
  const pts = samples
    .filter((s) => s.at)
    .map((s) => ({ t: Date.parse(s.at as string), v: (s.p - 1) * 100 + 1 }))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) throw new Error("no stargazer data");

  let dashedFrom: number | null = null;
  let archiveFrom: number | null = null;

  if (basic.s > pts[pts.length - 1].v) {
    // Beyond the API cap. Try the REAL archive first; only fall back to a
    // dashed estimate when the archive cannot be trusted for this repo.
    const log = reqLog("curve", { repo: basic.r });
    const archive = await fetchArchiveMonthly(basic.id);
    const archiveTotal = archive?.[archive.length - 1]?.total ?? 0;
    // coverage check: the archive misses suppressed viral bursts; require
    // it to account for at least 85% of live stars before trusting it
    const reliable = archive !== null && archiveTotal >= basic.s * 0.85;
    let stitched = false;
    if (reliable && archive) {
      // Anchor the archive stretch at BOTH ends: it must start exactly at
      // the last exact api point and end exactly at the live total. A
      // uniform end-only scale left a velocity step at the seam (observed:
      // tensorflow +9K in 16 days right after the 40K cap) that read as a
      // kink in the chart and in the draw animation.
      const lastExact = pts[pts.length - 1];
      const after = archive.findIndex((m) => m.t > lastExact.t);
      let archAtSeam = archiveTotal;
      if (after === 0) archAtSeam = 0;
      else if (after > 0) {
        const a = archive[after - 1];
        const b = archive[after];
        archAtSeam = a.total + ((b.total - a.total) * (lastExact.t - a.t)) / Math.max(1, b.t - a.t);
      }
      const remainArch = archiveTotal - archAtSeam;
      const remainLive = basic.s - lastExact.v;
      if (remainArch > 0 && remainLive > 0) {
        const k = remainLive / remainArch;
        const middle = archive
          .filter((m) => m.t > lastExact.t)
          .map((m) => ({ t: m.t, v: Math.round(lastExact.v + (m.total - archAtSeam) * k) }))
          .filter((m) => m.v > lastExact.v && m.v < basic.s);
        archiveFrom = pts.length - 1;
        pts.push(...middle, { t: Date.now(), v: basic.s });
        stitched = true;
        log.info("archive.used", { months: middle.length, archiveTotal,
          anchor: Math.round(archAtSeam), k: Math.round(k * 100) / 100 });
      }
    }
    if (!stitched) {
      dashedFrom = pts.length - 1;
      pts.push({ t: Date.now(), v: basic.s });
      log.info("archive.skipped", { archiveTotal, live: basic.s, reliable });
    }
  }
  return { repo: basic.r, total: basic.s, pts, dashedFrom, archiveFrom };
}

// Version of the curve reconstruction. Bump on ANY change to the data shape
// (sampling, normalization, stitching): the bump purges every cached curve
// on its next request, so pre-fix curves never linger out their TTL.
// v2: seam-anchored archive normalization. v3: per-repo tags + live total.
const CURVE_VERSION = 3;

export function curveTag(owner: string, name: string): string {
  return `curve:${owner.toLowerCase()}/${name.toLowerCase()}`;
}

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
  try {
    const basic = await repoBasic(owner, name);
    const pts = [...curve.pts];
    const last = pts[pts.length - 1];
    const syntheticTail = curve.dashedFrom !== null || (curve.archiveFrom ?? null) !== null;
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
