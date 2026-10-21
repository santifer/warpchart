// GITHUB TRENDING MARKS: on every collect, read github.com/trending (the
// general daily list and the javascript one) and record the days the house
// repo (mission.config.json) shows up, with its best place of the day. The
// velocity-rank panel draws them as ▲ on its x-axis, after the fixed archive
// list in src/lib/trending-marks.ts. Pure logic: collector/trending-marks-core.mjs.
//
// Written to the PRIVATE Blob, trending/marks.json. One snapshot per collect
// run (~every 2-5 h), so it is a floor: the repo may trend between two runs.
//
// VALIDATE BEFORE WRITING. The record accumulates, so a read that fails must
// never be taken for "no record yet": anything but 200 or 404 stops the run
// without writing, and a write that would lose a day of prev is refused. A
// page that parses to fewer than MIN_ROWS rows is not counted as checked, and
// if no page parsed, nothing is written and a partial marker is left.
//
// Usage: BLOB_READ_WRITE_TOKEN=... node collector/trending-marks.mjs [--out dir]
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LISTS, MIN_ROWS, losesHistory, parseTrending, recordSnapshot } from "./trending-marks-core.mjs";
import { allNamesOf, canonicalRepo, readConfig } from "./lib.mjs";
import { blobExists, markComplete, markPartial, writeJson } from "./blob.mjs";

const KEY = "trending/marks.json";
const FAMILY = "trending-marks";
const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const token = process.env.BLOB_READ_WRITE_TOKEN;

// 200 -> parsed JSON, a CONFIRMED 404 -> null, anything else THROWS. A 404 is
// double-checked with head(): starting a fresh record over an existing one
// would overwrite the whole history, and losesHistory cannot see it (no prev).
async function readJson(key) {
  const { get } = await import("@vercel/blob");
  const res = await get(key, { access: "private", token, useCache: false });
  if (!res || res.statusCode === 404) {
    const exists = await blobExists(key);
    if (exists !== false) throw new Error(`${key}: read said missing, head said ${exists === true ? "present" : "unknown"}`);
    return null;
  }
  if (res.statusCode !== 200 || !res.stream) throw new Error(`${key}: HTTP ${res.statusCode}`);
  return JSON.parse(await new Response(res.stream).text());
}

// one retry (INVARIANTS §3), short timeouts: worst case ~45 s for both lists
async function page(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "warpchart-collector (+https://warpchart.dev)", Accept: "text/html" },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) return await r.text();
      console.log(`[trending-marks] ${url}: HTTP ${r.status}`);
    } catch (e) {
      console.log(`[trending-marks] ${url}: ${e?.message ?? e}`);
    }
    if (i === 0) await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function main() {
  if (!token && !OUT) {
    console.log("[trending-marks] no BLOB_READ_WRITE_TOKEN, skipping");
    return;
  }
  const repo = canonicalRepo(readConfig().repo);
  const names = new Map(allNamesOf(repo).map((n) => [n.toLowerCase(), repo]));
  names.set(repo.toLowerCase(), repo);

  const at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const lists = {};
  for (const [list, url] of Object.entries(LISTS)) {
    const html = await page(url);
    const rows = html == null ? null : parseTrending(html);
    lists[list] = rows && rows.length >= MIN_ROWS ? rows : null;
    const pos = rows ? rows.findIndex((r) => names.has(r)) : -1;
    console.log(`[trending-marks] ${list}: ${rows == null ? "unreachable" : `${rows.length} rows`}${pos >= 0 ? `, ${repo} #${pos + 1}` : ""}`);
  }
  const failed = Object.keys(lists).filter((l) => !lists[l]);
  if (failed.length === Object.keys(lists).length) {
    await markPartial(FAMILY, { reason: `no trending page parsed (${failed.join(", ")})` });
    return;
  }

  const prev = token ? await readJson(KEY) : null; // throws on a transient error: nothing written
  const next = recordSnapshot(prev, { at, lists, names });
  const lost = losesHistory(prev, next);
  if (lost) {
    await markPartial(FAMILY, { reason: `refused: ${lost}` });
    return;
  }
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "marks.json"), JSON.stringify(next, null, 2));
  }
  if (token) await writeJson(KEY, next);
  if (failed.length) await markPartial(FAMILY, { reason: `list(s) not parsed this run: ${failed.join(", ")}` });
  else await markComplete(FAMILY);
  console.log(`[trending-marks] recorded ${at}: ${Object.keys(next.checks).length} checked days, ${Object.keys(next.marks[repo] ?? {}).length} days on Trending`);
}

main().catch(async (e) => {
  // never fails the collect run, but leaves a trace: a partial marker now,
  // the family going stale in the watchdog later
  console.error(`[trending-marks] ${e?.message ?? e}`);
  await markPartial(FAMILY, { reason: `nothing written: ${e?.message ?? e}` }).catch(() => {});
});
