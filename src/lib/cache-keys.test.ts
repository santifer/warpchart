import { beforeEach, describe, expect, it, vi } from "vitest";

// unstable_cache folds the call's arguments into the Data Cache key. GitHub
// names are case-insensitive, so /r/Foo/Bar and /r/foo/bar must read the SAME
// entry instead of each paying its own scan (and showing its own snapshot).

const calls = vi.hoisted(() => [] as { key: string[]; args: unknown[] }[]);
vi.mock("next/cache", () => ({
  unstable_cache:
    (_fn: unknown, key: string[]) =>
    async (...args: unknown[]) => {
      calls.push({ key, args });
      return { inputs: {}, degraded: false };
    },
}));

const keyOf = (c: { key: string[]; args: unknown[] }) => JSON.stringify([c.key, c.args]);

beforeEach(() => {
  calls.length = 0;
});

describe("Data Cache keys on the /r/ path", () => {
  it("explorer data: one entry for every casing of the repo", async () => {
    const { loadExplorerData } = await import("@/lib/explorer");
    await loadExplorerData("Sindresorhus", "Awesome");
    await loadExplorerData("sindresorhus", "awesome");
    expect(calls).toHaveLength(2);
    expect(keyOf(calls[0])).toBe(keyOf(calls[1]));
  });

  it("star curve (race panel, OG card): one entry for every casing of the repo", async () => {
    const { cachedSampleCurve } = await import("@/lib/curve");
    await cachedSampleCurve("Sindresorhus", "Awesome");
    await cachedSampleCurve("sindresorhus", "awesome");
    expect(calls).toHaveLength(2);
    expect(keyOf(calls[0])).toBe(keyOf(calls[1]));
  });
});
