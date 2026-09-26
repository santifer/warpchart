import { describe, expect, it } from "vitest";
import { canonicalVel0, canonicalVelocity } from "@/lib/velocity";

// The same repo must never show two different stars/day on two pages: every
// surface reads velocity through these two functions.
describe("canonical velocity", () => {
  it("prefers the trailing 7-day rate over the noisy 1-day diff", () => {
    expect(canonicalVelocity({ v7: 254, v: 224 })).toBe(254);
  });

  it("keeps a measured zero (a `||` here would fall back to the noisy rate)", () => {
    expect(canonicalVelocity({ v7: 0, v: 12 })).toBe(0);
  });

  it("falls back to v only while there is no 7-day baseline, and says null when nothing is known", () => {
    expect(canonicalVelocity({ v: 5 })).toBe(5);
    expect(canonicalVelocity({})).toBeNull();
  });

  it("never lets a negative rate into rankings", () => {
    expect(canonicalVel0({ v7: -2903 })).toBe(0);
    expect(canonicalVel0({})).toBe(0);
  });
});
