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
import { DATA_DIR } from "./lib.mjs";

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

// A star PURGE (GitHub deleting farmed stars, or a repo transfer) drops a repo
// by thousands in a single day. That step is a one-off correction, not growth,
// but a naive 7-day rate spreads it over the whole window: odysseus-dev/odysseus
// lost 21.8k on 2026-07-24 and read -2903/d for days while actually growing at
// ~120/d. A negative rate that large poisons every projection downstream (a
// rival "losing" 2900/d makes projectCrossing report an overtake in hours, and
// it stays wrong until the step falls out of the window). So: find the step and
// measure only AFTER it.
const PURGE_PCT = 0.02; // a single-day drop of >=2% of the count...
const PURGE_ABS = 300; // ...and >=300 stars, so ordinary unstar noise is ignored

// Baseline for the trailing rate. Returns { then: [dayMs, stars], purge } where
// `purge` is the ISO day of the most recent step inside the window, or null.
// series = [[isoDay, rank, stars], ...]
function baselineFor(series, targetMs, todayMs) {
  const pts = series
    .map((p) => [Date.parse(`${p[0]}T12:00:00Z`), p[2], p[0]])
    .filter((p) => Number.isFinite(p[0]) && p[1] != null && p[0] < todayMs - 0.5 * DAY)
    .sort((a, b) => a[0] - b[0]); // ignore today; oldest first
  if (!pts.length) return null;

  // most recent purge step inside [targetMs, now]
  let purgeIdx = -1;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] < targetMs) continue;
    const drop = pts[i - 1][1] - pts[i][1];
    if (drop >= PURGE_ABS && drop >= pts[i - 1][1] * PURGE_PCT) purgeIdx = i;
  }
  // measure from the first post-purge point: that count is the corrected one
  if (purgeIdx >= 0) return { then: [pts[purgeIdx][0], pts[purgeIdx][1]], purge: pts[purgeIdx][2] };

  // no step: the recorded point closest to the 7-day target
  let best = null;
  for (const p of pts) {
    if (best === null || Math.abs(p[0] - targetMs) < Math.abs(best[0] - targetMs)) {
      best = [p[0], p[1]];
    }
  }
  return best ? { then: best, purge: null } : null;
}

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
  // idempotent per route refresh: the heavy 32-shard read runs once a day
  if (route.v7_at && route.v7_at === route.generated_at) {
    console.log(`[velocity7] already computed for ${route.generated_at}, skipping`);
    return;
  }

  const todayMs = route.generated_at ? Date.parse(route.generated_at) : Date.now();
  const targetMs = todayMs - WINDOW_DAYS * DAY;

  // group route repos by shard, read each shard once, build a lowercased lookup
  const byShard = Array.from({ length: SHARDS }, () => []);
  for (const p of repos) if (p?.r) byShard[shardOf(p.r)].push(p);

  let withV7 = 0;
  let purged = 0;
  for (let i = 0; i < SHARDS; i++) {
    const list = byShard[i];
    if (!list.length) continue;
    const shard = await readJson(`${PREFIX}/shard-${i}.json`);
    const series = shard?.series ?? {};
    const lc = new Map();
    for (const k of Object.keys(series)) lc.set(k.toLowerCase(), series[k]);
    for (const p of list) {
      const s = lc.get(p.r.toLowerCase());
      if (!s || !s.length) continue;
      const base = baselineFor(s, targetMs, todayMs);
      if (!base) continue;
      const days = (todayMs - base.then[0]) / DAY;
      if (base.purge) {
        p.purge = base.purge;
        purged++;
      }
      if (days < 1) {
        // Baseline too short to measure. Normally we just leave `v` alone, but a
        // purge poisons `v` too (it is a ~1-day diff and the step IS that day),
        // so pin the rate to 0: "no measurable momentum" beats a false crash.
        if (base.purge) p.v7 = 0;
        continue;
      }
      let v7 = Math.round(((p.s - base.then[1]) / days) * 10) / 10;
      // Backstop for a step the series could not show (a gap in the history, a
      // rename): no real repo sheds >5% of its stars per day as growth.
      if (v7 < -Math.max(PURGE_ABS, p.s * 0.05)) {
        v7 = 0;
        if (!p.purge) {
          p.purge = "unknown";
          purged++;
        }
      }
      p.v7 = v7;
      withV7++;
    }
  }

  route.v7_at = route.generated_at;
  writeFileSync(routePath, JSON.stringify(route) + "\n");

  const sample = repos.find((p) => p.r?.toLowerCase() === "santifer/career-ops");
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
