// Runs a collector script in a child process against the stub Blob store, so a
// test can watch a whole read-modify-write the way production runs it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PRELOAD = fileURLToPath(new URL("./preload.mjs", import.meta.url));

export function runCollector(script, store, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "blob-stub-"));
  const stub = join(dir, "store.json");
  const logFile = join(dir, "ops.log");
  writeFileSync(stub, JSON.stringify(store));
  const res = spawnSync(process.execPath, ["--import", PRELOAD, fileURLToPath(script)], {
    encoding: "utf8",
    timeout: 30000,
    env: {
      PATH: process.env.PATH,
      BLOB_READ_WRITE_TOKEN: "stub",
      GH_TOKEN: "stub",
      BLOB_STUB: stub,
      BLOB_STUB_LOG: logFile,
      ...env,
    },
  });
  const ops = existsSync(logFile)
    ? readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  return { code: res.status, out: `${res.stdout}${res.stderr}`, ops, puts: ops.filter((o) => o.op === "put") };
}
