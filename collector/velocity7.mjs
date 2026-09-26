// Stable 7-day velocity for every routed repo, written back into route.json as
// `v7`. route.json's `v` is a ~1-day delta (collect.mjs diffs against the
// outgoing registry, which refreshes ~daily), so it is noisy: career-ops can
// read 224/d on `v` while its true 7-day pace is ~284/d. That noise was the
// root of contradictory ETAs across the product (the spatial scan-cards used a
// 7-day rate, the race used route `v`).
//
// This step is the keystone: ONE stable velocity at the source, inherited by
// every consumer that already reads route `v` (overtakes, collisions, the
// scan-cards, the race, the OG card). Source of truth for "stars 7 days ago" is
// the rank-history moat (route-history shards), which already records a daily
// point per top-10k repo. Pure read-modify-write of route.json; ADDITIVE (never
// touches `v`) and wrapped so it can never break the collect run.
//
// Runs AFTER collect.mjs writes route.json and BEFORE sync-to-blob, so the
// patched route.json ships in the same run. Guarded by a `v7_at` stamp so the
// 32-shard read happens once per route refresh (~daily), not every 2h.
//
// Usage: BLOB_READ_WRITE_TOKEN=... node collector/velocity7.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { get } from "@vercel/blob";
import { DATA_DIR, allNamesOf } from "./lib.mjs";
import { v7For } from "./velocity7-core.mjs";

const SHARDS = 32; // MUST match src/lib/rank-history.ts and route-history.mjs
const PREFIX = "route-history";
const WINDOW_DAYS = 7;
const DAY = 864e5;

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.log("[velocity7] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

// deterministic fnv-1a, identical to shardOf() in route-history.mjs + rank-history.ts
function shardOf(repo) {
  let h = 2166136261;
  const s = repo.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % SHARDS;
}

async function readJson(key) {
  try {
    const res = await get(key, { access: "private", token });
    if (res?.statusCode === 200 && res.stream) {
      return JSON.parse(await new Response(res.stream).text());
    }
  } catch {
    /* missing or transient */
  }
  return null;
}

// Purge/restore detection and the per-repo 7-day math live in
// velocity7-core.mjs (pure, shared with the tests).

async function main() {
  const routePath = join(DATA_DIR, "route.json");
  if (!existsSync(routePath)) {
    console.log("[velocity7] no route.json, skipping");
    return;
  }
  const route = JSON.parse(readFileSync(routePath, "utf8"));
  const repos = route?.repos ?? [];
  if (!repos.length) {
    console.log("[velocity7] empty route, skipping");
    return;
  }
  // idempotent per route refresh: the heavy 32-shard read runs once a day.
  // V7_FORCE=1 overrides it, so a fix to the rate math can be applied to the
  // live route without waiting for the next registry refresh.
  if (!process.env.V7_FORCE && route.v7_at && route.v7_at === route.generated_at) {
    console.log(`[velocity7] already computed for ${route.generated_at}, skipping`);
    return;
  }

  const todayMs = route.generated_at ? Date.parse(route.generated_at) : Date.now();
  const targetMs = todayMs - WINDOW_DAYS * DAY;

  // group route repos by shard, read each shard once, build a lowercased lookup.
  // A renamed/transferred repo (mission.aliases.json) has points under EVERY
  // name it carried, and different names live in different shards: register the
  // repo in each of its names' shards and merge the per-name series by day, so
  // the 7d baseline survives the transfer instead of resetting to "no baseline".
  const namesCache = new Map();
  const namesFor = (r) => {
    let n = namesCache.get(r);
    if (!n) { n = allNamesOf(r); namesCache.set(r, n); }
    return n;
  };
  const byShard = Array.from({ length: SHARDS }, () => []);
  for (const p of repos) {
    if (!p?.r) continue;
    for (const i of new Set(namesFor(p.r).map((n) => shardOf(n)))) byShard[i].push(p);
  }

  const shardSeries = new Map(); // shard index -> lowercased name -> series
  let withV7 = 0;
  let purged = 0;
  for (let i = 0; i < SHARDS; i++) {
    if (!byShard[i].length) continue;
    const shard = await readJson(`${PREFIX}/shard-${i}.json`);
    const series = shard?.series ?? {};
    const lc = new Map();
    for (const k of Object.keys(series)) lc.set(k.toLowerCase(), series[k]);
    shardSeries.set(i, lc);
  }
  {
    const seen = new Set();
    const list = [];
    for (const arr of byShard) for (const p of arr) if (!seen.has(p) && seen.add(p)) list.push(p);
    for (const p of list) {
      // merge points across every historical name, canonical last (wins the day)
      const byDay = new Map();
      for (const nm of namesFor(p.r)) {
        for (const lcMap of shardSeries.values()) {
          for (const pt of lcMap.get(nm.toLowerCase()) ?? []) byDay.set(pt[0], pt);
        }
      }
      const s = [...byDay.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      if (!s || !s.length) continue;
      const r = v7For(p.s, s, targetMs, todayMs);
      if (!r) continue;
      if (r.purge === "unknown") {
        if (!p.purge) {
          p.purge = "unknown";
          purged++;
        }
      } else if (r.purge) {
        p.purge = r.purge;
        purged++;
      }
      if (r.v7 === undefined) continue;
      p.v7 = r.v7;
      if (r.measured) withV7++;
    }
  }

  route.v7_at = route.generated_at;
  writeFileSync(routePath, JSON.stringify(route) + "\n");

  const sample = repos.find((p) => ["santifer/career-ops","career-ops-hq/career-ops"].includes(p.r?.toLowerCase()));
  console.log(
    `[velocity7] ${withV7}/${repos.length} repos got a 7d velocity` +
      ` · ${purged} measured from after a star purge` +
      (sample ? ` · career-ops v=${sample.v}/d v7=${sample.v7 ?? "n/a"}/d` : "")
  );
}

main().catch((err) => {
  // never break the collect run: a bad v7 pass just leaves route.json on `v`
  console.error(`[velocity7] failed (non-fatal): ${err?.message ?? err}`);
  process.exit(0);
});
