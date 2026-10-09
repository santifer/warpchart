// npm downloads BY VERSION over npm's last complete week: the adoption of each
// release (does anyone move to v1.34.0?). npm only answers this for "last week";
// the history is recorded by collector/npm-versions.mjs, one file per npm week.
//
// Traps, all of the "absence or the wrong date read as a number" family:
// - a package that does not exist answers HTTP 200 with `downloads: {}`: that
//   is "no data", never "0 downloads" -> null;
// - the versions endpoint does not say WHICH week it covers. The week is taken
//   from /downloads/point/last-week (start/end), and the two are only accepted
//   together when their totals agree, so a reading that straddles npm's weekly
//   roll is refused instead of being dated wrong;
// - these are DOWNLOADS (npx runs, CI, mirrors), not people. Label them so.
export interface VersionDownloads {
  version: string;
  d: number;
}

export function parseVersionDownloads(json: unknown): VersionDownloads[] | null {
  const dl = (json as { downloads?: Record<string, unknown> } | null)?.downloads;
  if (!dl || typeof dl !== "object") return null;
  const list = Object.entries(dl)
    .filter(([, n]) => typeof n === "number" && Number.isFinite(n) && n > 0)
    .map(([version, n]) => ({ version, d: n as number }))
    .sort((a, b) => b.d - a.d || compareVersions(b.version, a.version));
  return list.length ? list : null;
}

// Minimal semver order: numeric core first, and a release beats its own
// prerelease (1.34.0 > 1.34.0-beta.1); build metadata (+...) is ignored.
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const noBuild = v.split("+")[0];
    const dash = noBuild.indexOf("-");
    const core = dash === -1 ? noBuild : noBuild.slice(0, dash);
    const pre = dash === -1 ? "" : noBuild.slice(dash + 1);
    return { nums: core.split(".").map((x) => Number.parseInt(x, 10) || 0), pre };
  };
  const A = split(a);
  const B = split(b);
  for (let i = 0; i < Math.max(A.nums.length, B.nums.length); i++) {
    const d = (A.nums[i] ?? 0) - (B.nums[i] ?? 0);
    if (d) return d;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return A.pre.localeCompare(B.pre, undefined, { numeric: true });
}

export const newestVersion = (list: VersionDownloads[]) =>
  [...list].map((v) => v.version).sort((a, b) => compareVersions(b, a))[0] ?? null;

// The rows the panel shows: the top versions by downloads, the rest folded into
// one line, and each version's share of the week.
export function summarizeVersions(list: VersionDownloads[], top = 4) {
  const total = list.reduce((a, b) => a + b.d, 0);
  const rows = list.slice(0, top).map((v) => ({ ...v, share: total ? v.d / total : 0 }));
  const restList = list.slice(top);
  const rest = restList.length ? { versions: restList.length, d: restList.reduce((a, b) => a + b.d, 0) } : null;
  return { total, rows, rest };
}

// Accept a versions reading only with the week it belongs to, and only when its
// total matches npm's own total for that week.
export function datedWeek(
  versions: VersionDownloads[] | null,
  point: { downloads?: unknown; start?: unknown; end?: unknown } | null,
): { list: VersionDownloads[]; start: string; end: string } | null {
  if (!versions || !point || typeof point.start !== "string" || typeof point.end !== "string") return null;
  const total = versions.reduce((a, b) => a + b.d, 0);
  if (point.downloads !== total) return null; // straddled npm's weekly roll: refuse, retry later
  return { list: versions, start: point.start, end: point.end };
}

export async function npmVersionWeek(pkg: string) {
  const get = async (url: string) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok ? res.json() : null;
  };
  try {
    const enc = encodeURIComponent(pkg);
    const [v, p] = await Promise.all([
      get(`https://api.npmjs.org/versions/${enc}/last-week`),
      get(`https://api.npmjs.org/downloads/point/last-week/${enc}`),
    ]);
    return datedWeek(parseVersionDownloads(v), p);
  } catch {
    return null;
  }
}

// npm's live reading cannot be dated while its daily series has holes (the
// point total skips the hole, the per-version counts do not, so the two never
// agree). Instead of dropping the panel, fall back to the newest week the
// collector DID date and record (collector/npm-versions.mjs), and show its own
// week: older but true beats current but undated. File shape:
// { package, start, end, total, versions: { "1.34.0": 490, ... }, recordedAt }.
export const RECORDED_MAX_AGE_DAYS = 21; // older than this, show nothing rather than a stale week

export function parseRecordedWeek(
  json: unknown,
  pkg: string,
  todayISO = new Date().toISOString().slice(0, 10),
): { list: VersionDownloads[]; start: string; end: string } | null {
  const w = json as { package?: unknown; start?: unknown; end?: unknown; versions?: unknown } | null;
  if (!w || w.package !== pkg || typeof w.start !== "string" || typeof w.end !== "string") return null;
  const ageDays = (Date.parse(`${todayISO}T00:00:00Z`) - Date.parse(`${w.end}T00:00:00Z`)) / 86_400_000;
  if (!(ageDays <= RECORDED_MAX_AGE_DAYS)) return null;
  const list = parseVersionDownloads({ downloads: w.versions });
  return list ? { list, start: w.start, end: w.end } : null;
}

export async function recordedVersionWeek(pkg: string, repoNames: string[]) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const { list, get } = await import("@vercel/blob");
    // the history lives under the canonical name at write time; a transfer
    // adds a prefix, so every name the repo has carried is searched
    const blobs = (
      await Promise.all(
        repoNames.map((r) =>
          list({ prefix: `npm-versions/${r.toLowerCase().replace("/", "--")}/`, token }).then((x) => x.blobs),
        ),
      )
    ).flat();
    // newest npm week first (the file name IS the week's last day)
    const newest = blobs.sort((a, b) => b.pathname.localeCompare(a.pathname));
    for (const b of newest.slice(0, 3)) {
      const res = await get(b.pathname, { access: "private", token, useCache: false });
      if (res?.statusCode !== 200 || !res.stream) continue;
      const week = parseRecordedWeek(JSON.parse(await new Response(res.stream).text()), pkg);
      if (week) return week;
    }
    return null;
  } catch {
    return null;
  }
}
