#!/usr/bin/env node
// Mirror the local data/ directory UP to the PRIVATE Blob store under the
// data/ prefix. This is the moat: the accumulated star history lives here,
// never in the public git repo. Run by the collector after it computes a new
// snapshot (no git commit), and locally to seed the store.
//
// Usage: BLOB_READ_WRITE_TOKEN=... node scripts/sync-to-blob.mjs
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { put } from "@vercel/blob";
import { PREFIX, MIRROR_SKIP } from "./sync-to-blob-core.mjs";

const DATA = join(process.cwd(), "data");
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error("Missing BLOB_READ_WRITE_TOKEN");
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// Keys with their own direct writer are never mirrored back up: see MIRROR_SKIP
// in sync-to-blob-core.mjs for why each one is there.
const files = walk(DATA);
let n = 0;
for (const f of files) {
  const rel = relative(DATA, f).split(sep).join("/");
  if (MIRROR_SKIP.has(rel)) continue;
  await put(PREFIX + rel, readFileSync(f), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    token,
  });
  n++;
}
console.log(`[sync-to-blob] mirrored ${n} files to the private store under ${PREFIX}`);
