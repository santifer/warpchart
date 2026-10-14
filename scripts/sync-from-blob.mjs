#!/usr/bin/env node
// Mirror the PRIVATE Blob store's data/ prefix DOWN into the local data/
// directory. Runs as `prebuild` so every Vercel build (and local dev) hydrates
// the accumulated star history from the private store instead of from git. A
// fork has no token, gets nothing, and falls back to the committed data-sample/
// so the app still builds and renders a demo: the code is open, the data is not.
//
// Usage: BLOB_READ_WRITE_TOKEN=... node scripts/sync-from-blob.mjs
import { mkdirSync, writeFileSync, existsSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { list, get } from "@vercel/blob";

const ROOT = process.cwd();
const DATA = join(ROOT, "data");
const SAMPLE = join(ROOT, "data-sample");
const PREFIX = "data/";
const token = process.env.BLOB_READ_WRITE_TOKEN;

async function pull() {
  if (!token) return false;
  const blobs = [];
  let cursor;
  do {
    const res = await list({ prefix: PREFIX, cursor, token, abortSignal: AbortSignal.timeout(60_000) });
    blobs.push(...res.blobs);
    cursor = res.cursor;
  } while (cursor);
  if (!blobs.length) return false;
  for (const b of blobs) {
    const rel = b.pathname.slice(PREFIX.length);
    if (!rel) continue;
    const dest = join(DATA, rel);
    mkdirSync(dirname(dest), { recursive: true });
    // useCache:false: the collector read-modify-writes this copy, and a CDN
    // copy of a file rewritten minutes ago would be written back over it.
    const res = await get(b.pathname, { access: "private", token, useCache: false, abortSignal: AbortSignal.timeout(60_000) });
    if (res?.statusCode === 200 && res.stream) {
      const buf = Buffer.from(await new Response(res.stream).arrayBuffer());
      writeFileSync(dest, buf);
    }
  }
  console.log(`[sync-from-blob] pulled ${blobs.length} files from the private store`);
  return true;
}

function seedFromSample() {
  if (existsSync(SAMPLE)) {
    mkdirSync(DATA, { recursive: true });
    cpSync(SAMPLE, DATA, { recursive: true });
    console.log("[sync-from-blob] no private data (fork / no token); seeded from data-sample/");
  } else {
    console.log("[sync-from-blob] no private data and no sample; app renders empty");
  }
}

// The sample fallback is for FORKS (no token). With a token, a failed pull is
// an outage of the private store, not a fork: on 2026-10-14 18:34Z one Blob
// 500 made a production build seed data-sample/ and warpchart.dev served
// "DEMO · warpchart/sample" instead of career-ops until a manual redeploy.
// So with a token we retry, and if the store still fails we FAIL THE BUILD:
// Vercel then keeps the last good deployment live.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = false;
let lastErr = null;
for (let attempt = 1; attempt <= (token ? 4 : 1); attempt++) {
  try {
    ok = await pull();
    lastErr = null;
    break;
  } catch (err) {
    lastErr = err;
    console.error(`[sync-from-blob] attempt ${attempt} failed: ${err.message}`);
    if (token && attempt < 4) await sleep(3000 * attempt);
  }
}
if (token && (lastErr || !ok)) {
  console.error(
    `[sync-from-blob] the private store could not be read (${lastErr ? lastErr.message : "no files under data/"}). ` +
      "Refusing to build production on sample data; the previous deployment stays live.",
  );
  process.exit(1);
}
if (!ok) seedFromSample();
