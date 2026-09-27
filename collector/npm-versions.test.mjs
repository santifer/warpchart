import { describe, expect, it } from "vitest";
import { candidatePackages, datedWeek, npmWeekKey, parseVersionMap } from "./npm-versions.mjs";

describe("npm-versions collector", () => {
  it("never records an empty answer as zero (npm says 200 + {} for a missing package)", () => {
    expect(parseVersionMap({ package: "@career-ops-hq/career-ops", downloads: {} })).toBeNull();
    expect(parseVersionMap({ downloads: { "1.34.0": 454, "1.0.0": 0 } })).toEqual({ "1.34.0": 454 });
  });

  // Review catch: the versions endpoint does not say its week; it must be dated
  // with npm's own start/end, and refused when the totals disagree.
  it("dates a week with npm's start/end only when the totals agree", () => {
    const v = { "1.33.0": 1719, "1.34.0": 490 };
    expect(datedWeek(v, { downloads: 2209, start: "2026-09-19", end: "2026-09-25" })).toEqual({
      start: "2026-09-19", end: "2026-09-25", total: 2209, versions: v,
    });
    expect(datedWeek(v, { downloads: 2300, start: "2026-09-20", end: "2026-09-26" })).toBeNull();
    expect(datedWeek(v, { error: "package not found" })).toBeNull();
  });

  it("keys one append-only file per npm week", () => {
    expect(npmWeekKey("career-ops-hq/career-ops", "2026-09-25")).toBe("npm-versions/career-ops-hq--career-ops/2026-09-25.json");
  });

  it("tries the package under every name the repo has carried", () => {
    expect(candidatePackages("career-ops-hq/career-ops")).toEqual(["@career-ops-hq/career-ops", "@santifer/career-ops"]);
  });
});
