#!/usr/bin/env node
// Daily catalog for the rising-by-category directory (/c, /api/v1/rising,
// get_rising, the CLI). It runs its OWN shallow deep sweep (top-3000, ~30-40
// search calls) so it is independent of route-history's snapshot gate, and
// self-gates to once per UTC day. It writes data/catalog.json INTO the private
// Blob under the data/ prefix, so the build's sync-from-blob hydrates it exactly
// like route.json and the pages read it via fs. Cache-only at request time;
// zero GitHub calls in the app.
//
// Usage: BLOB_READ_WRITE_TOKEN=... GH_TOKEN=... node collector/catalog.mjs
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { put, get } from "@vercel/blob";
import { DATA_DIR, topReposDeep } from "./lib.mjs";

const CATALOG_KEY = "data/catalog.json";
const LIMIT = 3000;

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.log("[catalog] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
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

// idempotent per UTC day: bail before the sweep if today is already built
// (unless --force, e.g. to backfill a new field into today's catalog)
const force = process.argv.includes("--force");
const prev = await readJson(CATALOG_KEY);
if (!force && prev?.generated_at?.slice(0, 10) === today && prev?.repos?.length) {
  console.log(`[catalog] ${today} already built (${prev.repos.length} repos), nothing to do`);
  process.exit(0);
}

let deep = [];
try {
  deep = await topReposDeep(LIMIT);
} catch (err) {
  console.error(`[catalog] sweep failed: ${err.message}`);
}
if (!deep.length) {
  console.log("[catalog] no distribution available, skipping");
  process.exit(0);
}
const ranked = deep.map((r, i) => ({ ...r, rank: i + 1 }));

// velocity: fresh top-1000 velocities from the committed registry, then fall
// back to a diff against yesterday's catalog for everything deeper
const routeV = new Map();
const routeV7 = new Map();
const routePath = join(DATA_DIR, "route.json");
if (existsSync(routePath)) {
  try {
    const route = JSON.parse(readFileSync(routePath, "utf8"));
    for (const p of route.repos ?? []) {
      if (p?.r && p.v != null) routeV.set(p.r.toLowerCase(), p.v);
      // carry the stable 7-day rate too, so catalog consumers (badges, /c,
      // rising, the galaxy) can show the canonical velocity, not the noisy v
      if (p?.r && p.v7 != null) routeV7.set(p.r.toLowerCase(), p.v7);
    }
  } catch {
    /* no usable route.json */
  }
}
const prevStars = new Map();
let prevDays = 0;
if (prev?.repos?.length && prev.generated_at) {
  for (const p of prev.repos) if (p?.r) prevStars.set(p.r.toLowerCase(), p.s);
  prevDays = (Date.parse(today + "T12:00:00Z") - Date.parse(prev.generated_at)) / 864e5;
}

const repos = ranked.map((r) => {
  const key = r.r.toLowerCase();
  let v = routeV.has(key) ? routeV.get(key) : null;
  if (v == null && prevDays > 0.25 && prevStars.has(key)) {
    v = Math.round(((r.s - prevStars.get(key)) / prevDays) * 10) / 10;
  }
  const v7 = routeV7.has(key) ? routeV7.get(key) : null;
  return { r: r.r, rank: r.rank, s: r.s, v, v7, l: r.l ?? null, t: r.t ?? [], d: r.d ?? null, f: r.f ?? 0, c: r.c ?? null };
});

await writeJson(CATALOG_KEY, { generated_at: new Date().toISOString(), repos });
const withV = repos.filter((p) => p.v != null && p.v > 0).length;
const withTopics = repos.filter((p) => p.t.length).length;
console.log(`[catalog] built ${today}: ${repos.length} repos · ${withV} with velocity · ${withTopics} with topics`);
