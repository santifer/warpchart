import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// IndexNow had no timeout and its step no cap: an endpoint that accepted the
// connection and never answered held the run until the job cap cancelled
// everything after it, the deploy included.

// Every fetch in the child hangs until its own signal fires. The interval
// stands in for the open socket that keeps a real process alive.
const HANG = "data:text/javascript," + encodeURIComponent(`
globalThis.fetch = (u, init) => new Promise((_, rej) => {
  const socket = setInterval(() => {}, 1000);
  init?.signal?.addEventListener("abort", () => { clearInterval(socket); rej(init.signal.reason); });
});`);

// lib.mjs resolves data/ next to collector/, so the script runs from a copy
// of collector/ whose data/ holds a one-repo registry.
function run(env) {
  const root = mkdtempSync(join(tmpdir(), "indexnow-"));
  const dataDir = join(root, "data");
  mkdirSync(join(root, "collector"));
  mkdirSync(dataDir);
  // every collector module (not only indexnow's direct imports), so a new
  // shared module never breaks this copy
  const here = new URL("./", import.meta.url);
  for (const f of readdirSync(here).filter((n) => n.endsWith(".mjs") && !n.endsWith(".test.mjs"))) {
    copyFileSync(new URL(f, here), join(root, "collector", f));
  }
  writeFileSync(join(dataDir, "route.json"), JSON.stringify({ repos: [{ r: "a/b" }] }));
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(process.execPath, ["--import", HANG, join(root, "collector", "indexnow.mjs")], {
      env: { ...process.env, ...env },
      timeout: 10_000,
    }, (err, stdout, stderr) => resolve({ err, stdout, stderr, ms: Date.now() - started, dataDir }));
  });
}

describe("indexnow: a hung endpoint", () => {
  it("is abandoned, exits 0, and leaves no stamp", { timeout: 15_000 }, async () => {
    const r = await run({ INDEXNOW_TIMEOUT_MS: "200" });
    expect(r.err?.killed).not.toBe(true);
    expect(r.err).toBeNull();
    expect(r.stderr).toMatch(/\[indexnow\] failed \(non-fatal\)/);
    expect(r.ms).toBeLessThan(5_000);
    // not submitted, so tomorrow's run is not skipped
    expect(existsSync(join(r.dataDir, "indexnow-stamp.txt"))).toBe(false);
  });
});
