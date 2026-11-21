import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// data/ is immutable per deploy, so a loader must parse its file once per
// instance, not once per call (a /r/ render parsed route.json four times).

const reads = vi.hoisted(() => ({ n: new Map<string, number>() }));
vi.mock("node:fs", async (orig) => {
  const actual = await orig<typeof import("node:fs")>();
  const readFileSync = ((p: string, ...rest: unknown[]) => {
    reads.n.set(path.basename(String(p)), (reads.n.get(path.basename(String(p))) ?? 0) + 1);
    return (actual.readFileSync as (...a: unknown[]) => unknown)(p, ...rest);
  }) as typeof actual.readFileSync;
  return { ...actual, default: { ...actual, readFileSync }, readFileSync };
});

let root: string;
const route = (s: number) => JSON.stringify({ generated_at: "2026-10-19T00:00:00Z", repos: [{ r: "a/b", s }] });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "history-memo-"));
  mkdirSync(path.join(root, "data"));
  writeFileSync(path.join(root, "data", "route.json"), route(100));
  writeFileSync(path.join(root, "data", "history.jsonl"), '{"ts":"2026-10-19T00:00:00Z","stars":1,"rank":9}\n');
  vi.spyOn(process, "cwd").mockReturnValue(root);
  reads.n.clear();
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("history loaders", () => {
  it("parse each data file once, however many times they are called", async () => {
    const { loadRoute, loadHistory, lastSnapshot } = await import("@/lib/history");
    for (let i = 0; i < 4; i++) {
      expect(loadRoute()?.repos[0].s).toBe(100);
      expect(lastSnapshot()?.rank).toBe(9);
    }
    loadHistory();
    expect(reads.n.get("route.json")).toBe(1);
    expect(reads.n.get("history.jsonl")).toBe(1);
  });

  it("re-read a file that changed on disk (next dev under a collector run)", async () => {
    const { loadRoute } = await import("@/lib/history");
    expect(loadRoute()?.repos[0].s).toBe(100);
    const p = path.join(root, "data", "route.json");
    writeFileSync(p, route(2000));
    const later = new Date(Date.now() + 5_000);
    utimesSync(p, later, later);
    expect(loadRoute()?.repos[0].s).toBe(2000);
  });

  it("hand out a frozen value, so no caller can rewrite what the next request reads", async () => {
    const { loadRoute } = await import("@/lib/history");
    const r = loadRoute()!;
    expect(() => (r.repos as { r: string; s: number }[]).push({ r: "x/y", s: 1 })).toThrow(TypeError);
    expect(() => {
      (r.repos[0] as { s: number }).s = 1;
    }).toThrow(TypeError);
    expect(loadRoute()?.repos[0].s).toBe(100);
  });

  it("keep a missing file null, never a cached stale value", async () => {
    const { loadMeta } = await import("@/lib/history");
    expect(loadMeta()).toBeNull();
    writeFileSync(path.join(root, "data", "meta.json"), '{"repo":"warpchart/sample"}');
    expect(loadMeta()?.repo).toBe("warpchart/sample");
  });
});
