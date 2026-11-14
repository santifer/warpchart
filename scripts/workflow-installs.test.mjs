import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every workflow installs from package-lock.json. A bare
// `npm install @vercel/blob --no-save` ran in jobs holding the Blob token and
// floated within 2.x outside the lockfile's integrity hashes; builders.yml
// pinned sharp by hand to 0.34.5 under a comment saying it matched the lock
// (it did not, and 0.34.5 ships libvips/libheif/librsvg with published
// advisories, fixed in 0.35.5).

const dir = new URL("../.github/workflows/", import.meta.url);
const workflows = readdirSync(dir).filter((f) => f.endsWith(".yml"));
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const atLeast = (v, min) => {
  const a = v.split(/[.-]/).map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

describe("workflow installs", () => {
  it("finds the workflows", () => {
    expect(workflows).toEqual(expect.arrayContaining(["collect.yml", "live.yml", "health.yml", "builders.yml"]));
  });

  for (const f of workflows) {
    it(`${f}: no install outside the lockfile`, () => {
      const lines = readFileSync(new URL(f, dir), "utf8").split("\n").filter((l) => !/^\s*#/.test(l));
      const floating = lines.filter((l) => /\bnpm\s+(install|i|add)\b|\byarn\s+add\b|\bpnpm\s+add\b/.test(l));
      expect(floating).toEqual([]);
    });
  }

  it("sharp is declared, and every copy in the lockfile is at least 0.35.5", () => {
    expect(pkg.devDependencies.sharp ?? pkg.dependencies.sharp).toBeDefined();
    const copies = Object.entries(lock.packages)
      .filter(([path]) => /(^|\/)node_modules\/sharp$/.test(path))
      .map(([path, p]) => [path, p.version]);
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.filter(([, v]) => !atLeast(v, "0.35.5"))).toEqual([]);
  });

  it("@vercel/blob comes from the lockfile at an exact version", () => {
    expect(lock.packages["node_modules/@vercel/blob"]?.version).toMatch(/^2\.\d+\.\d+$/);
  });
});
