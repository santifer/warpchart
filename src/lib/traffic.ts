// Reads a repo's Traffic Vault (collector/traffic.mjs) from the PRIVATE Blob:
// the accumulated daily views, daily clones and latest top referrers that GitHub
// itself deletes after 14 days. Server-side only, cached. Returns null when no
// vault exists yet (no token configured, or first run pending): the panel then
// shows its empty/locked state.
import { get } from "@vercel/blob";
import { unstable_cache } from "next/cache";

interface RawVault {
  repo: string;
  views: Record<string, { c: number; u: number }>;
  clones: Record<string, { c: number; u: number }>;
  referrers: { r: string; c: number; u: number }[];
  referrersAt: string | null;
  updatedAt: string | null;
  uniq14?: { cloners: number | null; visitors: number | null; at: string };
}

export interface TrafficDay {
  d: string;
  views: number;
  viewsU: number;
  clones: number;
  clonesU: number;
}

export interface TrafficVault {
  days: TrafficDay[]; // chronological, accumulated beyond GitHub's 14-day window
  referrers: { r: string; c: number; u: number }[];
  totalViews: number;
  totalClones: number;
  daysKept: number;
  // When the collector last RAN. Not the same thing as how fresh the data is,
  // and the difference is not academic: on 2026-08-16/17 GitHub's traffic API
  // went 503 and stopped publishing new days, so the vault kept stamping
  // updatedAt on every 2-hour run while its newest day stayed frozen at the
  // 15th. A panel that reports this field alone tells the reader "updated
  // today" over two-day-old numbers.
  updatedAt: string | null;
  // The newest day the series actually contains. THIS is the freshness the
  // reader cares about. GitHub publishes a day with ~1 day of lag, so 1-2 days
  // behind is normal and only 3+ means the feed stalled (same threshold the
  // watchdog's fresh.traffic-days check uses).
  newestDay: string | null;
  // GitHub's own deduplicated 14-day headcount, straight from the API's
  // top-level `uniques`. THE ONLY FIGURE ALLOWED TO SAY "UNIQUE".
  //
  // The per-day `u` fields in `days` are uniques PER DAY. Summing them counts a
  // person once for every day they appeared, so the 72-day sum read 91,685 while
  // the real deduplicated count was 29,837 (2026-08-13). The public panel was
  // publishing that sum under the label "UNIQUE CLONERS". A cumulative CLONE
  // count is fine and is what totalClones is for; a cumulative PEOPLE count
  // cannot be built from this data at all.
  //
  // null when the vault predates collection of these fields: render nothing
  // rather than falling back to a sum.
  uniq14: { cloners: number | null; visitors: number | null; at: string } | null;
}

function blobKey(repo: string): string {
  return `traffic/${repo.toLowerCase().replace("/", "--")}.json`;
}

async function readVault(repo: string): Promise<TrafficVault | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const res = await get(blobKey(repo), { access: "private", token });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const raw = JSON.parse(await new Response(res.stream).text()) as RawVault;
    if (!raw?.views) return null;
    const dates = new Set([...Object.keys(raw.views ?? {}), ...Object.keys(raw.clones ?? {})]);
    const days: TrafficDay[] = [...dates]
      .sort()
      .map((d) => ({
        d,
        views: raw.views?.[d]?.c ?? 0,
        viewsU: raw.views?.[d]?.u ?? 0,
        clones: raw.clones?.[d]?.c ?? 0,
        clonesU: raw.clones?.[d]?.u ?? 0,
      }));
    if (!days.length) return null;
    return {
      days,
      referrers: raw.referrers ?? [],
      totalViews: days.reduce((s, d) => s + d.views, 0),
      totalClones: days.reduce((s, d) => s + d.clones, 0),
      daysKept: days.length,
      updatedAt: raw.updatedAt ?? null,
      newestDay: days[days.length - 1]?.d ?? null,
      uniq14: raw.uniq14 ?? null,
    };
  } catch {
    return null;
  }
}

export function loadTrafficVault(repo: string): Promise<TrafficVault | null> {
  // BUMP THIS KEY WHENEVER THE SHAPE CHANGES. unstable_cache is not scoped to a
  // deploy: without a new key the old shape keeps being served by the very
  // deploy that added the field, and the new one reads as "missing data".
  // v2 = added newestDay.
  return unstable_cache(() => readVault(repo), ["traffic-vault-v2", repo.toLowerCase()], {
    revalidate: 300,
  })();
}
