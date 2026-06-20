#!/usr/bin/env node
// Daily snapshot of the worldwide top-10,000 distribution into a SHARDED index
// in the PRIVATE Blob (route-history/shard-{i}.json + meta.json), plus a cold
// archive (archive/shard-{i}.json) that keeps every day past the 90-day hot
// window. The moat, stated honestly: a repo's worldwide RANK over time CAN be
// roughly reconstructed from GH Archive, but those reconstructions DRIFT (GH
// Archive misses un-stars and double-counts; GitHub's API returns only CURRENT
// stargazers), whereas we record the LIVE authoritative rank each day. That
// accurate, dated rank-of-record is the asset a competitor cannot retroactively
// obtain. At pay-time (and on the pricing page's locked preview) any of the top
// 10k gets its real rank trajectory, "already there".
//
// Sharded because Next's data cache caps a cached item at 2MB: 10k repos x ~90
// days would be ~22MB in one object. 32 shards keyed by a deterministic hash
// (mirrored in src/lib/rank-history.ts) keep each readable unit ~0.7MB.
//
// Isolated from collect.mjs on purpose, best-effort, and idempotent on the UTC
// day (it checks meta BEFORE the ~100-call deep fetch), so running it on every
// collect records exactly one point per day at ~zero marginal cost on repeats.
//
// Usage: BLOB_READ_WRITE_TOKEN=... GH_TOKEN=... node collector/route-history.mjs
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { put, get } from "@vercel/blob";
import { DATA_DIR, topReposDeep } from "./lib.mjs";

const SHARDS = 32; // MUST match src/lib/rank-history.ts
const CAP_DAYS = 90; // a touch over the 2-month chart window; bounds shard size
const PREFIX = "route-history";
const META_KEY = `${PREFIX}/meta.json`;
const LIMIT = 10000;

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.log("[route-history] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

// deterministic fnv-1a, identical to shardOf() in src/lib/rank-history.ts
function shardOf(repo) {
  let h = 2166136261;
  const s = repo.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % SHARDS;
}

async function readJson(key, useCache = true) {
  try {
    // useCache=false bypasses the Blob CDN cache so a just-written object is read
    // back from origin (a stale CDN copy would drop the same-run archive append).
    const res = await get(key, { access: "private", token, useCache });
    if (res?.statusCode === 200 && res.stream) {
      return JSON.parse(await new Response(res.stream).text());
    }
  } catch {
    /* missing or transient */
  }
  return null;
}

async function writeJson(key, value) {
  await put(key, JSON.stringify(value), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
}

const today = new Date().toISOString().slice(0, 10);

// idempotent: bail before the expensive deep fetch if today is already recorded
const meta = (await readJson(META_KEY)) ?? { days: [] };
meta.days ??= [];
if (meta.days.includes(today)) {
  console.log(`[route-history] ${today} already recorded (${meta.days.length} days), nothing to do`);
  process.exit(0);
}

// gather today's distribution: the deep top-10k, falling back to the committed
// top-1000 route.json if the search sweep is unavailable (no token / failure)
let ranked = [];
try {
  const deep = await topReposDeep(LIMIT);
  ranked = deep.map((r, i) => ({ ...r, rank: i + 1 }));
  console.log(`[route-history] deep sweep: ${ranked.length} repos`);
} catch (err) {
  console.error(`[route-history] deep sweep failed: ${err.message}`);
}
if (!ranked.length) {
  const routePath = join(DATA_DIR, "route.json");
  if (existsSync(routePath)) {
    try {
      const route = JSON.parse(readFileSync(routePath, "utf8"));
      ranked = (route.repos ?? []).map((r, i) => ({ ...r, rank: i + 1 }));
      console.log(`[route-history] fell back to route.json: ${ranked.length} repos`);
    } catch {
      /* no usable route.json */
    }
  }
}
if (!ranked.length) {
  console.log("[route-history] no distribution available, skipping");
  process.exit(0);
}

// first run only: seed yesterday from the committed top-1000 route-prev.json so
// the locked preview has a real two-point trajectory from day one
let seedDay = null;
let seedRanked = [];
if (!meta.days.length) {
  const prevPath = join(DATA_DIR, "route-prev.json");
  if (existsSync(prevPath)) {
    try {
      const prev = JSON.parse(readFileSync(prevPath, "utf8"));
      const d = (prev.generated_at ?? "").slice(0, 10);
      if (d && d < today) {
        seedDay = d;
        seedRanked = (prev.repos ?? []).map((r, i) => ({ ...r, rank: i + 1 }));
      }
    } catch {
      /* no usable prev */
    }
  }
}

// bucket repos by shard, then read-modify-write each shard once
const byShard = Array.from({ length: SHARDS }, () => ({ today: [], seed: [] }));
for (const r of ranked) if (r?.r) byShard[shardOf(r.r)].today.push(r);
for (const r of seedRanked) if (r?.r) byShard[shardOf(r.r)].seed.push(r);

const cutoffIso = (() => {
  const all = [...(seedDay ? [seedDay] : []), ...meta.days, today].sort();
  return all.length > CAP_DAYS ? all[all.length - CAP_DAYS] : all[0];
})();

let totalPoints = 0;
let maxShardBytes = 0;
for (let i = 0; i < SHARDS; i++) {
  const { today: tlist, seed: slist } = byShard[i];
  if (!tlist.length && !slist.length) continue;
  const shard = (await readJson(`${PREFIX}/shard-${i}.json`)) ?? { dates: [], series: {} };
  shard.dates ??= [];
  shard.series ??= {};

  const ingest = (day, list) => {
    if (!day || shard.dates.includes(day)) return;
    shard.dates.push(day);
    for (const r of list) (shard.series[r.r] ??= []).push([day, r.rank, r.s]);
  };
  if (seedDay) ingest(seedDay, slist);
  ingest(today, tlist);

  // COLD ARCHIVE: before rolling the 90-day hot window, append the points about
  // to fall out to this shard's append-only archive (route-history/archive/
  // shard-{i}.json). The hot shards stay bounded for the 2MB data cache; the
  // archive deepens forever, so the rank-of-record moat is never silently
  // destroyed at day 91. Written BEFORE the hot roll so a crash duplicates (the
  // archive dedups) rather than loses; useCache:false because the archive grows.
  const evicting = [];
  for (const k of Object.keys(shard.series)) {
    for (const p of shard.series[k]) if (p[0] < cutoffIso) evicting.push([k, p[0], p[1], p[2]]);
  }
  if (evicting.length) {
    const aKey = `${PREFIX}/archive/shard-${i}.json`;
    const arch = (await readJson(aKey, false)) ?? { series: {} };
    arch.series ??= {};
    for (const [repo, day, rank, stars] of evicting) {
      const arr = (arch.series[repo] ??= []);
      if (!arr.some((q) => q[0] === day)) arr.push([day, rank, stars]);
    }
    await writeJson(aKey, arch);
  }

  // roll the window
  shard.dates = shard.dates.filter((d) => d >= cutoffIso).sort();
  for (const k of Object.keys(shard.series)) {
    shard.series[k] = shard.series[k].filter((p) => p[0] >= cutoffIso);
    if (!shard.series[k].length) delete shard.series[k];
    else totalPoints += shard.series[k].length;
  }

  const body = JSON.stringify(shard);
  maxShardBytes = Math.max(maxShardBytes, Buffer.byteLength(body));
  await writeJson(`${PREFIX}/shard-${i}.json`, shard);
}

// update meta last (so a mid-run failure just retries next run)
if (seedDay) meta.days.push(seedDay);
meta.days.push(today);
meta.days = [...new Set(meta.days)].sort().slice(-CAP_DAYS);
meta.shards = SHARDS;
meta.updatedAt = new Date().toISOString();
await writeJson(META_KEY, meta);

console.log(
  `[route-history] recorded ${today}${seedDay ? ` (+seed ${seedDay})` : ""}: ${ranked.length} repos · ` +
    `${meta.days.length} days · ${totalPoints} points · largest shard ${(maxShardBytes / 1e6).toFixed(2)}MB`,
);
