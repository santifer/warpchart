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
import { DATA_DIR, topReposDeep } from "./lib.mjs";
import { acceptUniverse } from "./guards.mjs";
import { markPartial, markComplete, readFresh, partialKey, readJsonStrict, writeJsonIf } from "./blob.mjs";

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

const today = new Date().toISOString().slice(0, 10);

// Every read below feeds a write, so it is fresh (useCache:false) and honest:
// only a 404 is "nothing stored yet". A read that fails stops the run before it
// writes anything. It used to read as empty, and then a 503 on meta restarted
// the series from the seed day, and a 503 on a shard replaced 90 days of it
// with today. The day stays open for the next run, and the watchdog is told.
async function readOrStop(key) {
  try {
    return await readJsonStrict(key);
  } catch (err) {
    await markPartial("route-history", { day: today, reason: `could not read ${key}: ${err.message}` });
    console.log(`[route-history] NOT recording ${today}: could not read ${key} (${err.message}). Nothing was written.`);
    process.exit(0);
  }
}

// idempotent: bail before the expensive deep fetch if today is already recorded
const metaRead = await readOrStop(META_KEY);
const meta = metaRead.state === "data" ? metaRead.value : { days: [] };
meta.days ??= [];
if (meta.days.includes(today)) {
  console.log(`[route-history] ${today} already recorded (${meta.days.length} days), nothing to do`);
  process.exit(0);
}

// A refused sweep leaves the day open, and every run retries the ~4-minute deep
// sweep. Three refusals in the same day = the upstream is not coming back
// today: stop spending the job's budget on it and leave the day as a gap.
const openMarker = await readFresh(partialKey("route-history"));
if (openMarker && openMarker.resolved === false && openMarker.day === today && (openMarker.attempts ?? 1) >= 3) {
  console.log(`[route-history] ${today}: ${openMarker.attempts} refused sweeps today, not retrying until tomorrow (the day stays a gap)`);
  process.exit(0);
}

// gather today's distribution: the deep top-10k. (There used to be a fallback
// to the committed top-1000 route.json; a 1,000-repo "top-10k day" is exactly
// the truncated day the guard below refuses, so it is gone.)
let ranked = [];
// WHEN this day's counts were taken: the first run after 00:00Z, not noon.
// velocity7 dates each point with it (meta.capturedAt), so the 7-day window is
// measured between real capture times instead of a 7-12 h guess.
const capturedAt = new Date().toISOString();
try {
  const deep = await topReposDeep(LIMIT);
  ranked = deep.map((r, i) => ({ ...r, rank: i + 1 }));
  console.log(`[route-history] deep sweep: ${ranked.length} repos`);
} catch (err) {
  console.error(`[route-history] deep sweep failed: ${err.message}`);
}
if (!ranked.length) {
  console.log("[route-history] no distribution available, skipping");
  process.exit(0);
}

// VALIDATE BEFORE PUBLISHING. topReposDeep returns whatever it gathered when a
// search window fails, and this script used to record that as the day AND mark
// the day done, so the short day could never be retried: 2026-09-03 kept 4,039
// repos and 2026-09-11 6,012 of ~10,000, and every percentile computed on them
// looked better than it was. A refused sweep writes nothing, leaves the day
// open for the next run, and leaves a marker for the watchdog. A missing day is
// an honest gap; a truncated one is a lie that never throws.
const lastDay = [...meta.days].sort().at(-1);
const verdict = acceptUniverse(ranked.length, { want: LIMIT, prev: meta.counts?.[lastDay] ?? null });
if (!verdict.ok) {
  await markPartial("route-history", { day: today, got: ranked.length, want: LIMIT, reason: verdict.reason });
  console.log(`[route-history] NOT recording ${today}: ${verdict.reason}. The day stays open for the next run.`);
  process.exit(0);
}

// first run only: seed yesterday from the committed top-1000 route-prev.json so
// the locked preview has a real two-point trajectory from day one
let seedDay = null;
let seedAt = null;
let seedRanked = [];
if (!meta.days.length) {
  const prevPath = join(DATA_DIR, "route-prev.json");
  if (existsSync(prevPath)) {
    try {
      const prev = JSON.parse(readFileSync(prevPath, "utf8"));
      const d = (prev.generated_at ?? "").slice(0, 10);
      if (d && d < today) {
        seedDay = d;
        seedAt = prev.generated_at;
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
  const shardKey = `${PREFIX}/shard-${i}.json`;
  const shardRead = await readOrStop(shardKey);
  // Every shard holds every recorded day (10k repos spread over 32 shards), so
  // a shard that comes back empty while meta has days in the window is not a
  // new shard: writing it would keep only today. Refuse before any write.
  if (shardRead.state === "absent" || !shardRead.value?.dates?.length) {
    const inWindow = meta.days.filter((d) => d >= cutoffIso);
    if (inWindow.length) {
      await markPartial("route-history", { day: today, reason: `${shardKey} is empty but meta records ${inWindow.length} days` });
      console.log(`[route-history] NOT recording ${today}: ${shardKey} is empty but meta records ${inWindow.length} days.`);
      process.exit(0);
    }
  }
  const shard = shardRead.state === "data" ? shardRead.value : { dates: [], series: {} };
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
    const archRead = await readOrStop(aKey);
    const arch = archRead.state === "data" ? archRead.value : { series: {} };
    arch.series ??= {};
    for (const [repo, day, rank, stars] of evicting) {
      const arr = (arch.series[repo] ??= []);
      if (!arr.some((q) => q[0] === day)) arr.push([day, rank, stars]);
    }
    await writeJsonIf(aKey, arch, archRead.etag);
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
  await writeJsonIf(shardKey, shard, shardRead.etag);
}

// update meta last (so a mid-run failure just retries next run)
if (seedDay) meta.days.push(seedDay);
meta.days.push(today);
meta.days = [...new Set(meta.days)].sort().slice(-CAP_DAYS);
// the size of each recorded day, so the next sweep can be checked against it
meta.counts = Object.fromEntries(
  Object.entries({ ...(meta.counts ?? {}), [today]: ranked.length }).filter(([d]) => meta.days.includes(d)),
);
// real capture time per day; the seed day was counted when route-prev was built
meta.capturedAt = Object.fromEntries(
  Object.entries({
    ...(meta.capturedAt ?? {}),
    ...(seedDay ? { [seedDay]: seedAt } : {}),
    [today]: capturedAt,
  }).filter(([d, iso]) => meta.days.includes(d) && typeof iso === "string"),
);
meta.shards = SHARDS;
meta.updatedAt = new Date().toISOString();
await writeJsonIf(META_KEY, meta, metaRead.etag);
await markComplete("route-history", { day: today, got: ranked.length });

console.log(
  `[route-history] recorded ${today}${seedDay ? ` (+seed ${seedDay})` : ""}: ${ranked.length} repos · ` +
    `${meta.days.length} days · ${totalPoints} points · largest shard ${(maxShardBytes / 1e6).toFixed(2)}MB`,
);
