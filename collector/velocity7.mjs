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
// Runs AFTER collect.mjs writes route.json AND after route-history.mjs records
// the day (so the window can close on it), and BEFORE sync-to-blob, so the
// patched route.json ships in the same run. Guarded by a `v7_at` stamp (the
// later of the registry refresh and the newest recorded day's capture) so the
// 32-shard read happens when either moves, not every 2h.
//
// Per repo it writes v7, v1 (last full day, null = not measurable), v7_to (ISO
// of the point the window closes on) and trend ("accel" | "decay" | null).
//
// Usage: BLOB_READ_WRITE_TOKEN=... node collector/velocity7.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { get } from "@vercel/blob";
import { DATA_DIR, allNamesOf } from "./lib.mjs";
import { measureRepo, v7Stamp } from "./velocity7-core.mjs";
import { SHARDS, shardOf } from "./rules.mjs";

const PREFIX = "route-history";

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.log("[velocity7] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}


async function readJson(key) {
  try {
    // useCache:false - the shards and meta are rewritten daily; a CDN copy
    // would close the window on yesterday's point (INVARIANTS §2)
    const res = await get(key, { access: "private", token, useCache: false });
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
  // WHEN each recorded day was captured. Days recorded before capturedAt
  // existed fall back to noon inside the core; the newest one can still be
  // dated exactly, because meta.updatedAt is written by the run that recorded it.
  const meta = (await readJson(`${PREFIX}/meta.json`)) ?? {};
  const capturedAt = { ...(meta.capturedAt ?? {}) };
  const lastDay = [...(meta.days ?? [])].sort().at(-1) ?? null;
  if (lastDay && !capturedAt[lastDay] && typeof meta.updatedAt === "string" && meta.updatedAt.startsWith(lastDay)) {
    capturedAt[lastDay] = meta.updatedAt;
  }
  const stamp = v7Stamp(route.generated_at, lastDay ? capturedAt[lastDay] ?? null : null);

  // idempotent per stamp: the heavy 32-shard read runs when the registry
  // refreshes or a new day is recorded. V7_FORCE=1 overrides it, so a fix to
  // the rate math can be applied without waiting for either.
  if (!process.env.V7_FORCE && route.v7_at && route.v7_at === stamp) {
    console.log(`[velocity7] already computed for ${stamp}, skipping`);
    return;
  }

  const routeAtMs = route.generated_at ? Date.parse(route.generated_at) : Date.now();

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
      const r = measureRepo({ stars: p.s, routeAtMs }, s, capturedAt);
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
      // the doubt travels WITH the rate: written only when v7 is, so an old v7
      // left in place keeps its old v7_to and reads stale downstream
      p.v1 = r.v1;
      p.v7_to = r.v7_to;
      p.trend = r.trend;
      if (r.measured) withV7++;
    }
  }

  route.v7_at = stamp;
  writeFileSync(routePath, JSON.stringify(route) + "\n");

  const sample = repos.find((p) => ["santifer/career-ops","career-ops-hq/career-ops"].includes(p.r?.toLowerCase()));
  console.log(
    `[velocity7] ${withV7}/${repos.length} repos got a 7d velocity` +
      ` · ${purged} measured from after a star purge` +
      (sample ? ` · career-ops v=${sample.v}/d v7=${sample.v7 ?? "n/a"}/d v1=${sample.v1 ?? "n/a"}/d to ${sample.v7_to ?? "n/a"} trend=${sample.trend ?? "-"}` : "") +
      ` · stamp ${stamp}`
  );
}

main().catch((err) => {
  // never break the collect run: a bad v7 pass just leaves route.json on `v`
  console.error(`[velocity7] failed (non-fatal): ${err?.message ?? err}`);
  process.exit(0);
});
