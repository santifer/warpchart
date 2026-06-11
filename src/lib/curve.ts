// Shared cumulative-curve builder: the SVG embed and the JSON endpoint for
// the interactive page chart read the SAME cached reconstruction, so a
// visit warms the embed and vice versa.
import { unstable_cache } from "next/cache";
import { loadTimestamps, loadMeta, lastSnapshot } from "@/lib/history";
import { repoBasic, stargazerPageFirst } from "@/lib/github";

export interface Curve {
  repo: string;
  total: number;
  pts: { t: number; v: number }[];
  // points from this index on are extrapolated (REST caps stargazer
  // pagination at 40K stars), rendered as a dashed/estimated tail
  dashedFrom: number | null;
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
  const pts = samples
    .filter((s) => s.at)
    .map((s) => ({ t: Date.parse(s.at as string), v: (s.p - 1) * 100 + 1 }))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) throw new Error("no stargazer data");
  let dashedFrom: number | null = null;
  if (basic.s > pts[pts.length - 1].v) {
    dashedFrom = pts.length - 1;
    pts.push({ t: Date.now(), v: basic.s });
  }
  return { repo: basic.r, total: basic.s, pts, dashedFrom };
}

export const cachedSampleCurve = unstable_cache(sampleCurve, ["embed-chart-curve"], {
  revalidate: 21_600,
});

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
  return { repo: meta.repo, total: lastSnapshot()?.stars ?? n, pts, dashedFrom: null };
}

export function isTenantRepo(repo: string): boolean {
  const meta = loadMeta();
  return !!meta && meta.repo.toLowerCase() === repo.toLowerCase();
}
