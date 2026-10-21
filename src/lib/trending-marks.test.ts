import { describe, expect, it } from "vitest";
import { trendingMarksFor, type TrendingLiveRecord } from "./trending-marks";

describe("trendingMarksFor", () => {
  it("finds career-ops under its old name, its new name and any casing", () => {
    const a = trendingMarksFor("career-ops-hq/career-ops");
    expect(a?.marks).toHaveLength(31);
    expect(trendingMarksFor("santifer/career-ops")).toEqual(a);
    expect(trendingMarksFor("Career-Ops-HQ/Career-Ops")).toEqual(a);
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
    expect(days.every((d) => d <= t.archive!.through)).toBe(true);
  });
});

// the Blob record as collector/trending-marks-core.mjs writes it
const live: TrendingLiveRecord = {
  since: "2026-10-21T15:07:00Z",
  lastCheck: "2026-10-23T09:07:00Z",
  tracked: ["career-ops-hq/career-ops"],
  marks: {
    "career-ops-hq/career-ops": {
      "2026-10-22": { all: { pos: 4 }, javascript: { pos: 2 } },
      "2026-09-01": { javascript: { pos: 1 } }, // same day as an archive mark: the better place wins
    },
  },
};

describe("trendingMarksFor with the live record", () => {
  it("adds the live days to the archive, one entry per day and list, best place kept", () => {
    const t = trendingMarksFor("santifer/career-ops", live)!;
    expect(t.marks).toHaveLength(33);
    expect(t.marks.filter((m) => m.day === "2026-10-22")).toEqual([
      { day: "2026-10-22", list: "all", pos: 4 },
      { day: "2026-10-22", list: "javascript", pos: 2 },
    ]);
    expect(t.marks.filter((m) => m.day === "2026-09-01")).toEqual([{ day: "2026-09-01", list: "javascript", pos: 1 }]);
    expect(t.live).toEqual({ since: "2026-10-21T15:07:00Z", lastCheck: "2026-10-23T09:07:00Z" });
    expect(t.archive?.through).toBe("2026-10-21");
  });

  it("a live record that failed to read leaves the archive alone and claims no live window", () => {
    const t = trendingMarksFor("career-ops-hq/career-ops", null)!;
    expect(t.marks).toHaveLength(31);
    expect(t.live).toBeNull();
  });

  it("a repo the live record does not track gets nothing from it", () => {
    expect(trendingMarksFor("facebook/react", live)).toBeNull();
  });

  it("a record that never completed a check is not a live window", () => {
    expect(trendingMarksFor("career-ops-hq/career-ops", { ...live, lastCheck: null })!.live).toBeNull();
  });
});
