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

// pick the recorded point closest to `targetMs` without overshooting the
// present; returns [dayMs, stars] or null. series = [[isoDay, rank, stars], ...]
function pointNear(series, targetMs, todayMs) {
  let best = null;
  for (const p of series) {
    const t = Date.parse(`${p[0]}T12:00:00Z`);
    if (!Number.isFinite(t) || t >= todayMs - 0.5 * DAY) continue; // ignore today
    if (best === null || Math.abs(t - targetMs) < Math.abs(best[0] - targetMs)) {
      best = [t, p[2]];
    }
  }
  return best;
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
      const then = pointNear(s, targetMs, todayMs);
      if (!then) continue;
      const days = (todayMs - then[0]) / DAY;
      if (days < 1) continue; // too short a baseline to be meaningful
      p.v7 = Math.round(((p.s - then[1]) / days) * 10) / 10;
      withV7++;
    }
  }

  route.v7_at = route.generated_at;
  writeFileSync(routePath, JSON.stringify(route) + "\n");

  const sample = repos.find((p) => p.r?.toLowerCase() === "santifer/career-ops");
  console.log(
    `[velocity7] ${withV7}/${repos.length} repos got a 7d velocity` +
      (sample ? ` · career-ops v=${sample.v}/d v7=${sample.v7 ?? "n/a"}/d` : "")
  );
}

main().catch((err) => {
  // never break the collect run: a bad v7 pass just leaves route.json on `v`
  console.error(`[velocity7] failed (non-fatal): ${err?.message ?? err}`);
  process.exit(0);
});
