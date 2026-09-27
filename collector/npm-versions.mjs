// NPM BY VERSION, recorded as npm publishes it. npm only answers "downloads per
// version over the last week" for its CURRENT window (7 days, moving forward a
// day at a time): nobody can ask it for an older window later, so the adoption
// curve of each release exists only if every window is kept as it goes by
// (from 2026-09-27). About one new file per day.
//
// Stored APPEND-ONLY, one file per npm window: npm-versions/{owner}--{name}/{end}.json
// = { package, start, end, total, versions: { "1.34.0": 490, ... }, recordedAt }.
// No file is ever read and rewritten, so a failed read can never wipe the
// history (a first draft kept one file and would have replaced it with a single
// week after one transient Blob error; caught by review before it ran).
//
// Dated by npm, never by us: the versions endpoint does not say which week it
// covers, so the week comes from /downloads/point/last-week (start/end) and the
// two readings are only accepted together when their totals agree.
// Absence is never zero: npm answers 200 with `downloads: {}` for a package that
// does not exist (e.g. @career-ops-hq/career-ops after the transfer).
//
// Usage: BLOB_READ_WRITE_TOKEN=... node collector/npm-versions.mjs [owner/name ...]
import { pathToFileURL } from "node:url";
import { allNamesOf, canonicalRepo } from "./lib.mjs";
import { blobExists, writeJson } from "./blob.mjs";
import { unlockedSet } from "./prflow.mjs";

// History lives under the canonical name at write time. A future transfer adds
// a new prefix: whoever reads the history must merge the prefixes of every name
// in allNamesOf (as the traffic vault does).
export const npmWeekKey = (repo, end) => `npm-versions/${repo.toLowerCase().replace("/", "--")}/${end}.json`;

// { "1.34.0": 454, ... } with only positive counts, or null when npm had nothing
export function parseVersionMap(json) {
  const dl = json?.downloads;
  if (!dl || typeof dl !== "object") return null;
  const out = Object.fromEntries(Object.entries(dl).filter(([, n]) => typeof n === "number" && n > 0));
  return Object.keys(out).length ? out : null;
}

// The week a versions reading belongs to, or null when it cannot be dated or
// its total disagrees with npm's own total for that week (a reading taken
// across npm's weekly roll). Same rule as src/lib/npm-versions.ts datedWeek.
export function datedWeek(versions, point) {
  if (!versions || !point || typeof point.start !== "string" || typeof point.end !== "string") return null;
  const total = Object.values(versions).reduce((a, b) => a + b, 0);
  if (point.downloads !== total) return null;
  return { start: point.start, end: point.end, total, versions };
}

// Scoped names from every name the repo has carried, canonical first. The
// collector cannot see the repo's package.json (an unscoped package would be
// shown on the panel but not recorded here: a known gap, not a wrong number).
export function candidatePackages(repo) {
  return [...new Set([...allNamesOf(canonicalRepo(repo))].reverse().map((n) => `@${n.toLowerCase()}`))];
}

async function npmWeek(pkg) {
  const enc = encodeURIComponent(pkg);
  const get = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return res.ok ? res.json() : null;
  };
  const [v, p] = await Promise.all([
    get(`https://api.npmjs.org/versions/${enc}/last-week`),
    get(`https://api.npmjs.org/downloads/point/last-week/${enc}`),
  ]);
  return datedWeek(parseVersionMap(v), p);
}

async function recordRepo(repo) {
  const canonical = canonicalRepo(repo);
  for (const pkg of candidatePackages(canonical)) {
    const week = await npmWeek(pkg).catch(() => null);
    if (!week) continue;
    const key = npmWeekKey(canonical, week.end);
    const exists = await blobExists(key);
    if (exists === true) return console.log(`[npm-versions] ${canonical}: week ending ${week.end} already recorded`);
    if (exists === null) return console.log(`[npm-versions] ${canonical}: could not check ${key}, not writing (next run retries)`);
    await writeJson(key, { package: pkg, ...week, recordedAt: new Date().toISOString() });
    return console.log(
      `[npm-versions] ${canonical}: ${pkg} week ${week.start}..${week.end} · ${Object.keys(week.versions).length} versions · ${week.total} downloads`,
    );
  }
  console.log(`[npm-versions] ${canonical}: no dated npm week (no package, npm answered empty, or mid-roll), nothing written`);
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN missing");
  const repos = process.argv.slice(2).length ? process.argv.slice(2) : [...unlockedSet()];
  for (const repo of repos) {
    try {
      await recordRepo(repo);
    } catch (e) {
      console.error(`[npm-versions] ${repo} failed (non-fatal): ${e?.message ?? e}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error("[npm-versions] failed (non-fatal):", e?.message || e);
    process.exit(0); // never break the collect run
  });
}
