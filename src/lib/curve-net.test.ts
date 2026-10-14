import { describe, expect, it } from "vitest";
import { netCurvePoints } from "@/lib/curve";

// career-ops on 2026-10-14: 75,922 star timestamps (gross, unstars never
// removed) against 74,432 stars on GitHub. /compare drew 75.9K and said the
// house passed 75K on Oct 12; headroom (net) read right next to it.
const day = (i: number) => new Date(Date.UTC(2026, 3, 4) + i * 6 * 60_000).toISOString();
const ts = Array.from({ length: 75_922 }, (_, i) => day(i));

describe("netCurvePoints", () => {
  it("ends on the net count GitHub shows, not on the row count", () => {
    const pts = netCurvePoints(ts, 74_432, 300);
    expect(pts.at(-1)!.v).toBe(74_432);
  });

  it("stays whole and never goes down", () => {
    const pts = netCurvePoints(ts, 74_432, 300);
    expect(pts[0].v).toBe(1);
    for (let i = 1; i < pts.length; i++) {
      expect(Number.isInteger(pts[i].v)).toBe(true);
      expect(pts[i].v).toBeGreaterThanOrEqual(pts[i - 1].v);
    }
  });

  it("keeps the gross count when the net read is missing or implausible", () => {
    expect(netCurvePoints(ts, null, 300).at(-1)!.v).toBe(75_922);
    // a net count 50% below the rows is a broken read, not unstars
    expect(netCurvePoints(ts, 37_000, 300).at(-1)!.v).toBe(75_922);
  });
});
