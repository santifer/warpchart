// Reads a repo's Traffic Vault (collector/traffic.mjs) from the PRIVATE Blob:
// the accumulated daily views, daily clones and latest top referrers that GitHub
// itself deletes after 14 days. Server-side only, cached. Returns null when no
// vault exists yet (no token configured, or first run pending): the panel then
// shows its empty/locked state. Rejects when the store could not be read, and
// that is never cached: /api/traffic answers 503, not an empty vault.
import { unstable_cache } from "next/cache";
import { allNamesOf, canonicalRepo } from "./aliases";
import { readPrivateJson } from "./blob-read";
import { ciSplit, CI_CLONES_PER_CHECKOUT } from "../../collector/ci-checkouts-core.mjs";

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
  // `clones` as a band (collector/ci-checkouts-core.mjs): the repo's own CI
  // at least, CI-or-not, and NOT its CI at least, adding up to `clones`.
  // null = not counted that day (no CI record, or a day the collector has not
  // reached): never read as 0 CI.
  ciBand: { ciMin: number; unsure: number; notCiMin: number } | null;
}

// raw ci-checkouts/{owner}--{name}.json (collector/ci-checkouts.mjs)
interface RawCi {
  range?: { low: number; high: number };
  days?: Record<string, { runs: number; checkouts: number }>;
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
  // what the CI split rests on, for the chart's note; null = no CI record
  ci: { low: number; high: number; from: string; to: string } | null;
}

function blobKey(repo: string): string {
  return `traffic/${repo.toLowerCase().replace("/", "--")}.json`;
}

const ciKey = (repo: string) => `ci-checkouts/${repo.toLowerCase().replace("/", "--")}.json`;

// null on any failure, missing or unreadable: the chart then draws the plain
// clone line. The band is optional on purpose, so this is the one read here
// that does not throw; it still times out (readPrivateJson).
async function readOneCi(key: string, token: string): Promise<RawCi | null> {
  const raw = await readPrivateJson<RawCi>(key, token).catch(() => undefined);
  return raw?.days ? raw : null;
}

// null = no vault under this name. A failed read throws (readPrivateJson).
async function readOneVault(key: string, token: string): Promise<RawVault | null> {
  const raw = await readPrivateJson<RawVault>(key, token);
  return raw?.views ? raw : null;
}

async function readVault(repo: string): Promise<TrafficVault | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  // A renamed/transferred repo's vault history stays under its OLD blob key
  // while the collector writes new days under the new one. Read every name
  // the repo ever had and merge day-by-day; canonical (last) wins overlaps.
  // The vault is append-only per day, so the merge is lossless.
  const vaults = (
    await Promise.all(allNamesOf(repo).map((n) => readOneVault(blobKey(n), token)))
  ).filter((v): v is RawVault => v !== null);
  if (!vaults.length) return null;
  const raw: RawVault = vaults[0];
  for (const v of vaults.slice(1)) {
    raw.views = { ...raw.views, ...v.views };
    raw.clones = { ...raw.clones, ...v.clones };
    // point-in-time fields: keep the freshest snapshot's
    if ((v.updatedAt ?? "") >= (raw.updatedAt ?? "")) {
      raw.referrers = v.referrers;
      raw.referrersAt = v.referrersAt;
      raw.updatedAt = v.updatedAt;
      raw.uniq14 = v.uniq14;
    }
  }
  // the CI record, under every name the repo carried (as the vault)
  const cis = (await Promise.all(allNamesOf(repo).map((n) => readOneCi(ciKey(n), token)))).filter(
    (c): c is RawCi => c !== null,
  );
  const ciDays: NonNullable<RawCi["days"]> = Object.assign({}, ...cis.map((c) => c.days));
  const range = cis.at(-1)?.range ?? CI_CLONES_PER_CHECKOUT;
  const dates = new Set([...Object.keys(raw.views ?? {}), ...Object.keys(raw.clones ?? {})]);
  const days: TrafficDay[] = [...dates]
    .sort()
    .map((d) => {
      const clones = raw.clones?.[d]?.c;
      return {
        d,
        views: raw.views?.[d]?.c ?? 0,
        viewsU: raw.views?.[d]?.u ?? 0,
        clones: clones ?? 0,
        clonesU: raw.clones?.[d]?.u ?? 0,
        ciBand: ciSplit(clones, ciDays[d]?.checkouts, range),
      };
    });
  const ciCounted = days.filter((d) => d.ciBand != null).map((d) => d.d);
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
    ci: ciCounted.length ? { ...range, from: ciCounted[0], to: ciCounted[ciCounted.length - 1] } : null,
  };
}

export function loadTrafficVault(repo: string): Promise<TrafficVault | null> {
  // BUMP THIS KEY WHENEVER THE SHAPE CHANGES. unstable_cache is not scoped to a
  // deploy: without a new key the old shape keeps being served by the very
  // deploy that added the field, and the new one reads as "missing data".
  // v2 = added newestDay. v3 = alias-merged reads (rename survival), cached
  // under the canonical name so old/new query names share one entry. v4 =
  // ciBand per day + ci (the CI band of the clone series).
  return unstable_cache(() => readVault(repo), ["traffic-vault-v4", canonicalRepo(repo).toLowerCase()], {
    revalidate: 300,
  })();
}
