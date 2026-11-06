import { describe, expect, it, vi } from "vitest";
import { velocityQuality } from "@/lib/velocity";

// The whole route registry (1000 repos) is serialized into every /r/ page that
// draws a star chart. Only the fields the charts read may ride along.

const ROUTE = vi.hoisted(() => ({
  generated_at: "2026-10-19T00:00:00Z",
  repos: [
    { r: "apex/one", s: 500_000, d: "the core", l: "Markdown", f: 48_779, v: 300, v7: 310, v1: 290, v7_to: "2026-10-19T00:25:00Z", trend: null },
    { r: "mid/two", s: 90_000, d: "", l: null, f: 9_000, v: 80, v7: 120, v1: 400, v7_to: "2026-10-19T00:25:00Z", trend: "accel" as const },
    { r: "new/three", s: 60_000, d: null, l: "Go", f: 600, v: 12, v1: null },
    { r: "quiet/four", s: 50_000, f: 10, v: null },
  ],
}));
vi.mock("@/lib/history", () => ({ loadRoute: () => ROUTE }));

const CLIENT_FIELDS = new Set(["r", "s", "rank", "v", "d", "l", "v7", "trend", "v7_to"]);

describe("route layers sent to the client", () => {
  it("carry only the fields the charts read, and no nulls", async () => {
    const { buildRouteLayers } = await import("@/lib/bundle");
    const { all, dots, landmarks } = buildRouteLayers(40_000, [], { r: "apex/one", s: 500_000 }, "me/repo");
    expect(all).toHaveLength(4);
    for (const p of [...all, ...dots, ...landmarks]) {
      for (const [k, v] of Object.entries(p)) {
        expect(CLIENT_FIELDS.has(k), `field ${k} on ${p.r}`).toBe(true);
        expect(v, `${k} on ${p.r}`).not.toBeNull();
      }
    }
  });

  it("keep what the charts compute from: canonical rate, rank, scan card, rate quality", async () => {
    const { buildRouteLayers } = await import("@/lib/bundle");
    const { all } = buildRouteLayers(40_000, [], { r: "apex/one", s: 500_000 }, "me/repo");
    const by = new Map(all.map((p) => [p.r, p]));
    // v is the canonical rate: v7 when measured, the 1-day v otherwise, absent when unknown
    expect(by.get("mid/two")?.v).toBe(120);
    expect(by.get("new/three")?.v).toBe(12);
    expect(by.get("quiet/four")?.v ?? null).toBeNull();
    expect(all.map((p) => p.rank)).toEqual([1, 2, 3, 4]);
    expect(by.get("apex/one")).toMatchObject({ d: "the core", l: "Markdown" });
    // the promoted-dot ETA reads the same doubt and age it read before the trim
    for (const raw of ROUTE.repos) {
      expect(velocityQuality(by.get(raw.r))).toEqual(velocityQuality(raw));
    }
  });
});

describe("chartedAmong", () => {
  it("keeps only the charted repos a page can draw, matching case-insensitively", async () => {
    const { chartedAmong } = await import("@/lib/bundle");
    const listing = ["apex/one", "mid/two", "far/away", "other/repo"];
    expect(chartedAmong(listing, ["Apex/One", "MID/two", "new/three"])).toEqual(["apex/one", "mid/two"]);
    expect(chartedAmong(listing, [])).toEqual([]);
  });
});
