#!/usr/bin/env node
// Daily snapshot of the worldwide top-1000 distribution into a compact index in
// the PRIVATE Blob (route-history/index.json). This is the un-backfillable moat:
// a repo's star history can be reconstructed any time, but its WORLD RANK over
// time cannot, unless someone was recording the whole distribution each day.
// Now we are. At pay-time (and on the pricing page's locked preview) any repo
// that has been in the top 1000 gets its real rank trajectory, "already there".
//
// Isolated from collect.mjs on purpose: this only ever READS data/route.json
// (freshly written by collect) and writes its own Blob prefix, so it can never
// touch the critical snapshot path. Best-effort and idempotent on the route's
// own date, so running it on every collect (every ~2h) records exactly one
// point per daily route refresh.
//
// Usage: BLOB_READ_WRITE_TOKEN=... node collector/route-history.mjs
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { put, get } from "@vercel/blob";
import { DATA_DIR } from "./lib.mjs";

const KEY = "route-history/index.json";
const CAP_DAYS = 140; // a touch over the 2-month chart window; keeps the index small

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.log("[route-history] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

const routePath = join(DATA_DIR, "route.json");
if (!existsSync(routePath)) {
  console.log("[route-history] no route.json yet, skipping");
  process.exit(0);
}

const route = JSON.parse(readFileSync(routePath, "utf8"));
const day = (route.generated_at ?? "").slice(0, 10);
const repos = route.repos ?? [];
if (!day || !repos.length) {
  console.log("[route-history] route.json has no date/repos, skipping");
  process.exit(0);
}

// load the existing index (or start fresh)
let index = { dates: [], series: {} };
try {
  const res = await get(KEY, { access: "private", token });
  if (res?.statusCode === 200 && res.stream) {
    index = JSON.parse(await new Response(res.stream).text());
  }
} catch {
  /* first run, or transient: start fresh */
}
index.dates ??= [];
index.series ??= {};

// one [date, rank, stars] point per repo for a given day's distribution
function ingest(d, list) {
  if (!d || index.dates.includes(d)) return false;
  index.dates.push(d);
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r?.r) continue;
    (index.series[r.r] ??= []).push([d, i + 1, r.s]);
  }
  return true;
}

// First run: seed yesterday from the outgoing registry (route-prev.json) so the
// locked rank preview has a real two-point trajectory from day one instead of
// waiting a day for a second sample.
if (!index.dates.length) {
  const prevPath = join(DATA_DIR, "route-prev.json");
  if (existsSync(prevPath)) {
    try {
      const prev = JSON.parse(readFileSync(prevPath, "utf8"));
      const prevDay = (prev.generated_at ?? "").slice(0, 10);
      if (prevDay && prevDay < day) ingest(prevDay, prev.repos ?? []);
    } catch {
      /* no usable prev */
    }
  }
}

if (!ingest(day, repos)) {
  console.log(`[route-history] ${day} already recorded (${index.dates.length} days), nothing to do`);
  process.exit(0);
}
// keep chronological after a possible out-of-order prev seed
index.dates.sort();

// roll the window: drop points older than the cap so the index stays a few MB
if (index.dates.length > CAP_DAYS) {
  index.dates = index.dates.slice(-CAP_DAYS);
  const cutoff = index.dates[0];
  for (const k of Object.keys(index.series)) {
    index.series[k] = index.series[k].filter((p) => p[0] >= cutoff);
    if (!index.series[k].length) delete index.series[k];
  }
}

await put(KEY, JSON.stringify(index), {
  access: "private",
  addRandomSuffix: false,
  allowOverwrite: true,
  contentType: "application/json",
  token,
});

const bytes = Buffer.byteLength(JSON.stringify(index));
console.log(
  `[route-history] appended ${day}: ${repos.length} repos · ${index.dates.length} days retained · index ${(bytes / 1e6).toFixed(2)}MB`,
);
