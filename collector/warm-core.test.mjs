import { describe, expect, it } from "vitest";
import { warmPlan, spotlightIndex } from "./warm-core.mjs";

// The warm moved out of collect.mjs into its own step. The plan must be the
// same pages the inline warm fetched, in the same two windows.

const route = {
  generated_at: "2026-10-19T03:00:00Z",
  repos: Array.from({ length: 700 }, (_, i) => ({ r: `o/r${i}` })),
};
const neighbors = [{ r: "n/one" }, { r: "o/r7" }];

describe("warmPlan", () => {
  it("04 UTC: the featured ranks plus the neighbors, deduplicated", () => {
    const plan = warmPlan({ route, neighbors, now: new Date("2026-10-19T04:12:00Z"), routeRefreshed: false });
    expect(plan.map((p) => p.path)).toEqual(
      ["o/r0", "o/r7", "o/r24", "o/r79", "o/r199", "o/r499", "n/one"].map(
        (r) => `/api/chart?repo=${encodeURIComponent(r)}&w=800&h=240`,
      ),
    );
  });

  it("outside 04 UTC and no registry refresh: nothing", () => {
    expect(warmPlan({ route, neighbors, now: new Date("2026-10-19T06:00:00Z"), routeRefreshed: false })).toEqual([]);
  });

  it("a registry refresh warms the spotlight's whole surface", () => {
    const hero = route.repos[spotlightIndex(route.generated_at)].r;
    const plan = warmPlan({ route, neighbors: null, now: new Date("2026-10-19T10:00:00Z"), routeRefreshed: true });
    const q = encodeURIComponent(hero);
    expect(plan.map((p) => p.path)).toEqual([`/r/${hero}`, `/api/curve?repo=${q}`, `/api/chart?repo=${q}`, `/api/og?repo=${q}`]);
  });

  it("no registry: no crash, no spotlight", () => {
    expect(warmPlan({ route: null, neighbors: null, now: new Date("2026-10-19T10:00:00Z"), routeRefreshed: true })).toEqual([]);
  });
});
