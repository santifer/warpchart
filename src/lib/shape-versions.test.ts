import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHAPE_VERSION, cacheKey, type ShapeType } from "./shape-versions";

// Cache keys used to be bumped by hand, and a key that embeds another type had
// to be remembered separately: a Dossier change bumped dossier-vN and left
// explorer-data serving the old Dossier inside it for 15 minutes.

describe("derived cache keys", () => {
  it("changing the Dossier version changes both the dossier and explorer-data keys", () => {
    const bumped = { ...SHAPE_VERSION, dossier: SHAPE_VERSION.dossier + 1 };
    expect(cacheKey("dossier", bumped)).not.toBe(cacheKey("dossier"));
    expect(cacheKey("explorerData", bumped)).not.toBe(cacheKey("explorerData"));
    // and nothing that does not embed a Dossier
    for (const t of (Object.keys(SHAPE_VERSION) as ShapeType[]).filter((k) => k !== "dossier" && k !== "explorerData")) {
      expect(cacheKey(t, bumped)).toBe(cacheKey(t));
    }
  });

  it("a type's own bump moves only its key", () => {
    const bumped = { ...SHAPE_VERSION, explorerData: SHAPE_VERSION.explorerData + 1 };
    expect(cacheKey("explorerData", bumped)).not.toBe(cacheKey("explorerData"));
    expect(cacheKey("dossier", bumped)).toBe(cacheKey("dossier"));
  });

  it("keys with nothing embedded keep the strings they had, so those caches stay warm", () => {
    expect(cacheKey("dossier")).toBe("dossier-v17");
    expect(cacheKey("vitals")).toBe("vitals-v10");
    expect(cacheKey("trafficVault")).toBe("traffic-vault-v4");
    expect(cacheKey("prFlow")).toBe("prflow-v1");
    expect(cacheKey("curve")).toBe("embed-chart-curve-v6");
    expect(cacheKey("archiveMonthly")).toBe("archive-monthly-v1");
    expect(cacheKey("buildersWall")).toBe("builders-wall-v2");
    expect(cacheKey("explorerData")).toBe("explorer-data-v4.dossier17");
    expect(cacheKey("velocityRankMeta")).toBe("velocity-rank-meta-v2");
    expect(cacheKey("velocityRankMonth")).toBe("velocity-rank-month-v2");
    expect(cacheKey("velocityRankReconstructed")).toBe("velocity-rank-reconstructed-v3");
    expect(cacheKey("ladderBands")).toBe("ladder-bands-v1");
  });
});

// The sensor: no unstable_cache key is written by hand with a version in it.
// A key with no version (it caches nothing whose shape we change) is listed.
const UNVERSIONED = ["explore-search", "earned-badges", "codex-listing", "live-snapshot", "route-history-shard"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("every cache key is derived", () => {
  const root = new URL("..", import.meta.url).pathname;
  const files = sources(root).filter((f) => !f.endsWith("shape-versions.ts"));

  it("every unstable_cache call uses cacheKey() or an unversioned key on the list", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/unstable_cache\(/g)) {
        // the callback, the key array and the options: up to the TTL
        const call = src.slice(m.index, m.index + 900).split("revalidate")[0];
        // a version written by hand into a key ("dossier-v17", `-v${N}`)
        const handVersioned = /["'`][a-z][a-z-]*-v(\d|\$\{)/.test(call);
        if (!handVersioned && /cacheKey\(/.test(call)) continue;
        if (!handVersioned && UNVERSIONED.some((k) => call.includes(`"${k}"`))) continue;
        offenders.push(`${f.slice(root.length)}: ${call.slice(0, 120).replace(/\s+/g, " ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
