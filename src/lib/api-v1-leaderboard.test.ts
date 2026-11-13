import { describe, expect, it, vi } from "vitest";

// #34 (2026-11-13): the health watchdog's coherence.velocity went red because
// ultraworkers/claw-code, LOSING 24 stars/day, read 0 on /api/v1/leaderboard
// (clamped with canonicalVel0) and -24 on /api/v1/overtakes. A shown velocity
// is the signed canonical one; clamping is only for ranking.
vi.mock("@/lib/history", () => ({
  loadRoute: () => ({
    generated_at: "2026-11-13T00:00:00Z",
    repos: [
      { r: "a/grows", s: 300000, v7: 120.4, v: 90, l: "TypeScript" },
      { r: "ultraworkers/claw-code", s: 194788, v7: -24.2, v: -30, l: "Rust" },
      { r: "c/unmeasured", s: 150000, l: "Go" },
    ],
  }),
  loadCollisions: () => null,
}));

describe("leaderboard velocities", () => {
  it("shows a shrinking repo's real negative rate, not 0", async () => {
    const { leaderboard } = await import("@/lib/api-v1");
    const rows = leaderboard(10);
    expect(rows.find((r) => r.repo === "ultraworkers/claw-code")?.velocityPerDay).toBe(-24);
    expect(rows.find((r) => r.repo === "a/grows")?.velocityPerDay).toBe(120);
  });

  it("says null for an unmeasured rate, never 0", async () => {
    const { leaderboard, velocityCsv } = await import("@/lib/api-v1");
    const rows = leaderboard(10);
    expect(rows.find((r) => r.repo === "c/unmeasured")?.velocityPerDay).toBeNull();
    expect(velocityCsv(rows)).toContain("3,c/unmeasured,150000,,Go");
  });

  it("the fastest-movers ranking still lists only repos that grow", async () => {
    const { velocityRanking } = await import("@/lib/api-v1");
    expect(velocityRanking(10).map((r) => r.repo)).toEqual(["a/grows"]);
  });
});
