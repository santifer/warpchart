import { describe, expect, it } from "vitest";
import { cleanNpmSeries, estimateHoles, holesInWindow, npmHoles } from "@/lib/npm-gaps";

// The real npm range for @santifer/career-ops as served on 2026-10-09: it ends
// on 10-07, the same day as point/last-month (09-08 -> 10-07, 8,681). npm does
// not serve unpublished days, and 10-05/10-06 are holes it serves as 0.
const REAL = [
  ["2026-09-25", 288], ["2026-09-26", 226], ["2026-09-27", 233], ["2026-09-28", 354],
  ["2026-09-29", 340], ["2026-09-30", 305], ["2026-10-01", 445], ["2026-10-02", 293],
  ["2026-10-03", 183], ["2026-10-04", 225], ["2026-10-05", 0], ["2026-10-06", 0],
  ["2026-10-07", 292],
].map(([day, d]) => ({ day: day as string, d: d as number }));

describe("npm holes", () => {
  it("drops the holes instead of drawing them as zero, and keeps npm's last day", () => {
    const { series, holes } = cleanNpmSeries(REAL);
    expect(holes).toEqual(["2026-10-05", "2026-10-06"]);
    expect(series.some((p) => p.d === 0)).toBe(false);
    expect(series.at(-1)?.day).toBe("2026-10-07");
  });

  // Review catch: two days earlier the series ENDED in the holes. Trimming
  // trailing zeros as "unpublished" said "through Oct 4" with 3 missing days
  // while npm's window ran to 10-06 with 5 missing.
  it("counts a hole on the last day of the series, not trim it", () => {
    const { holes } = cleanNpmSeries(REAL.slice(0, -1)); // ends 10-06, as on 2026-10-07
    expect(holes).toEqual(["2026-10-05", "2026-10-06"]);
  });

  it("counts the holes inside npm's own window (09-08 -> 10-07 had four)", () => {
    const holes = ["2026-09-03", "2026-09-07", "2026-09-08", "2026-09-15", "2026-10-05", "2026-10-06"];
    expect(holesInWindow(holes, "2026-09-08", "2026-10-07")).toEqual([
      "2026-09-08", "2026-09-15", "2026-10-05", "2026-10-06",
    ]);
  });

  it("estimates a hole from the measured days around it, never from another hole", () => {
    // 10-05 and 10-06: neighbours 10-02..10-04 and 10-07 -> (293+183+225+292)/4 each
    expect(estimateHoles(REAL, ["2026-10-05", "2026-10-06"])).toBe(Math.round(2 * (293 + 183 + 225 + 292) / 4));
  });

  it("keeps the real zero days of a small package", () => {
    const small = [3, 0, 1, 0, 2, 0, 0, 4, 1].map((d, i) => ({ day: `2026-10-0${i + 1}`, d }));
    expect(npmHoles(small).size).toBe(0);
  });
});
