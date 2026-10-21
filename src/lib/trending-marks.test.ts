import { describe, expect, it } from "vitest";
import { trendingMarksFor } from "./trending-marks";

describe("trendingMarksFor", () => {
  it("finds career-ops under its old name, its new name and any casing", () => {
    const a = trendingMarksFor("career-ops-hq/career-ops");
    expect(a?.marks).toHaveLength(31);
    expect(trendingMarksFor("santifer/career-ops")).toBe(a);
    expect(trendingMarksFor("Career-Ops-HQ/Career-Ops")).toBe(a);
  });

  it("an untracked repo gets null, never an empty list that reads as 'never trended'", () => {
    expect(trendingMarksFor("facebook/react")).toBeNull();
  });

  it("matches the bonfy archive: first, last and the 18-22 Aug run at #1", () => {
    const m = trendingMarksFor("career-ops-hq/career-ops")!.marks;
    expect(m[0]).toEqual({ day: "2026-06-06", list: "javascript", pos: 3 });
    expect(m.at(-1)).toEqual({ day: "2026-09-01", list: "javascript", pos: 3 });
    const aug = m.filter((x) => x.day >= "2026-08-18" && x.day <= "2026-08-22");
    expect(aug.map((x) => x.pos)).toEqual([1, 1, 1, 1, 1]);
  });

  it("days are sorted, unique, and none is past the day the archive was checked", () => {
    const t = trendingMarksFor("career-ops-hq/career-ops")!;
    const days = t.marks.map((x) => x.day);
    expect([...days].sort()).toEqual(days);
    expect(new Set(days).size).toBe(days.length);
    expect(days.every((d) => d <= t.checkedThrough)).toBe(true);
  });
});
