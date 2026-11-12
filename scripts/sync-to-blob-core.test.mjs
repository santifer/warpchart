import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MIRROR_SKIP, PREFIX, mirrorKeys } from "./sync-to-blob-core.mjs";
import { ARTIFACTS, newestByFamily, staleArtifacts } from "../collector/health-rules.mjs";

// collect.yml: hydrate (sync-from-blob pulls every data/* key) -> producers ->
// mirror (sync-to-blob) -> catalog.mjs -> ... -> attribute.mjs. Replays one run
// against the Blob listing the watchdog's inventory.coverage reads.
function runMirror(blobs, at) {
  // the run's local data/ is exactly what the hydrate pulled
  const hydrated = blobs.filter((b) => b.pathname.startsWith(PREFIX)).map((b) => b.pathname.slice(PREFIX.length));
  const written = new Set(mirrorKeys(hydrated));
  return blobs.map((b) => (written.has(b.pathname) ? { ...b, uploadedAt: at } : b));
}

describe("the mirror and the watchdog's inventory", () => {
  const HOUR = 3_600_000;
  const now = Date.parse("2026-10-19T13:06:00Z");
  const iso = (ms) => new Date(ms).toISOString();
  // a healthy store: every declared family uploaded an hour ago...
  const healthy = ARTIFACTS.map((a) => ({ pathname: a.prefix.endsWith("/") ? a.prefix + "x.json" : a.prefix, uploadedAt: iso(now - HOUR) }));
  // ...except the producers that stopped. catalog.mjs keeps yesterday's catalog
  // when acceptUniverse refuses a short sweep, and attribute.mjs exits before
  // writing when the house repo cannot be read: both are silent, both leave the
  // previous Blob copy in place, and both copies get hydrated into data/.
  const stopped = { "data/catalog.json": iso(now - 75 * HOUR), "data/attribution.json": iso(now - 80 * HOUR) };
  const before = healthy.map((b) => (stopped[b.pathname] ? { ...b, uploadedAt: stopped[b.pathname] } : b));

  it("a stopped catalog or attribution producer is still stale after the mirror re-uploads data/", () => {
    const after = runMirror(before, iso(now));
    const { stale } = staleArtifacts(newestByFamily(after).newest, now);
    expect(stale.map((s) => s.prefix).sort()).toEqual(["data/attribution.json", "data/catalog.json"]);
  });

  it("the mirror still uploads the files only it writes (history, meta, route)", () => {
    const keys = mirrorKeys(["history.jsonl", "meta.json", "route.json", "catalog.json", "tenants.json", "attribution.json", "enrichment.json"]);
    expect(keys).toEqual(["data/history.jsonl", "data/meta.json", "data/route.json"]);
  });

  // The blind spot reopens the day someone adds a direct Blob writer under
  // data/ and forgets the skip list. Find every such writer in the source.
  it("skips every data/ key that has its own direct Blob writer", () => {
    const root = join(import.meta.dirname, "..");
    const walk = (dir) =>
      readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : /\.(mjs|ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : [],
      );
    const direct = new Set();
    for (const f of [...walk("collector"), ...walk("src")]) {
      const src = readFileSync(join(root, f), "utf8");
      for (const [, key] of src.matchAll(/\bput\(\s*["'`]data\/([^"'`$]+)["'`]/g)) direct.add(key);
      for (const [, name, key] of src.matchAll(/\bconst (\w+) = ["'`]data\/([^"'`$]+)["'`]/g)) {
        if (new RegExp(`\\b(put|writeJson)\\(\\s*${name}\\b`).test(src)) direct.add(key);
      }
    }
    expect([...direct].sort()).toEqual(["attribution.json", "catalog.json", "enrichment.json", "tenants.json"]);
    for (const key of direct) expect(MIRROR_SKIP.has(key)).toBe(true);
  });
});
