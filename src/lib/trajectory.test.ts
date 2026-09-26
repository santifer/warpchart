import { describe, expect, it } from "vitest";
import { toTrajectory } from "@/lib/trajectory";

describe("toTrajectory", () => {
  const points: [string, number, number][] = [
    ["2026-07-28", 9, 110],
    ["2026-07-27", 10, 100],
  ];

  // 2026-07-28 08:26 UTC: today's point was stamped at noon, ahead of "now",
  // and the curve ran backwards until midday.
  it("never dates a point later than the moment it was read", () => {
    const now = Date.parse("2026-07-28T08:26:00Z");
    const t = toTrajectory(points, now);
    expect(t.at(-1)?.t).toBe(now);
    expect(t.every((p) => p.t <= now)).toBe(true);
  });

  it("keeps the noon stamp once noon has passed, oldest first", () => {
    const t = toTrajectory(points, Date.parse("2026-07-28T15:00:00Z"));
    expect(t.map((p) => p.t)).toEqual([Date.parse("2026-07-27T12:00:00Z"), Date.parse("2026-07-28T12:00:00Z")]);
    expect(t.map((p) => p.stars)).toEqual([100, 110]);
  });
});
