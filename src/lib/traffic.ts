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
  updatedAt: string | null;
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
    };
  } catch {
    return null;
  }
}

export function loadTrafficVault(repo: string): Promise<TrafficVault | null> {
  return unstable_cache(() => readVault(repo), ["traffic-vault", repo.toLowerCase()], {
    revalidate: 300,
  })();
}
