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
    const res = await list({ prefix: PREFIX, cursor, token });
    blobs.push(...res.blobs);
    cursor = res.cursor;
  } while (cursor);
  if (!blobs.length) return false;
  for (const b of blobs) {
    const rel = b.pathname.slice(PREFIX.length);
    if (!rel) continue;
    const dest = join(DATA, rel);
    mkdirSync(dirname(dest), { recursive: true });
    const res = await get(b.pathname, { access: "private", token });
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

try {
  const ok = await pull();
  if (!ok) seedFromSample();
} catch (err) {
  console.error(`[sync-from-blob] failed: ${err.message}`);
  // never fail the build: fall back to whatever local/sample data exists
  if (!existsSync(join(DATA, "meta.json"))) seedFromSample();
}
