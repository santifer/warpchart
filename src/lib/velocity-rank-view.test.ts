import { describe, expect, it } from "vitest";
import { fillCalendar, lastDays, liveSplit, monthStarts, rankTicks, tierOf, trailingMedian, weekOverWeek } from "./velocity-rank-view";

// career-ops, 6-19 Oct 2026 (collector/velocity-rank.mjs on the real moat),
// (the gap cases below use their own series)
const pts = [
  ["2026-10-06", 110], ["2026-10-07", 116], ["2026-10-08", 63], ["2026-10-09", 155],
  ["2026-10-10", 142], ["2026-10-11", 138], ["2026-10-12", 111], ["2026-10-13", 83],
  ["2026-10-14", 69], ["2026-10-15", 23], ["2026-10-16", 67], ["2026-10-17", 110],
  ["2026-10-18", 84], ["2026-10-19", 81],
].map(([day, rank]) => ({ day: day as string, rank: rank as number }));

describe("weekOverWeek", () => {
  it("compares the last 7 calendar days with the 7 before (lower = better)", () => {
    expect(weekOverWeek(pts)).toEqual({
      lastDay: "2026-10-19",
      last: 81,
      thisWeek: 81, // 13-19 Oct: 83 69 23 67 110 84 81
      prevWeek: 116, // 6-12 Oct: 110 116 63 155 142 138 111
      best: { day: "2026-10-15", rank: 23 },
    });
  });

  it("a week with fewer than 4 measured days has no median, never a 1-day 'trend'", () => {
    const holes = pts.map((p) => (p.day < "2026-10-13" && p.day !== "2026-10-12" ? { ...p, rank: null } : p));
    expect(weekOverWeek(holes).prevWeek).toBeNull();
    expect(weekOverWeek(holes).thisWeek).toBe(81);
  });
});

describe("trailingMedian", () => {
  it("does not borrow older days across a gap", () => {
    const gappy = [
      { day: "2026-09-01", rank: 95 }, { day: "2026-09-02", rank: null }, { day: "2026-09-03", rank: null },
      { day: "2026-09-04", rank: 101 }, { day: "2026-09-05", rank: 91 }, { day: "2026-09-06", rank: 110 },
    ];
    // 31 Aug - 6 Sep window holds 4 measured days on 6 Sep, only 3 on 5 Sep
    expect(trailingMedian(gappy)).toEqual([null, null, null, null, null, 98]);
  });
});

describe("fillCalendar", () => {
  it("puts a null on every unmeasured day so the line breaks there (1-6 Jul ran straight across)", () => {
    const f = fillCalendar([{ day: "2026-06-30", rank: 45 }, { day: "2026-07-03", rank: 11 }]);
    expect(f.map((p) => [p.day, p.rank])).toEqual([
      ["2026-06-30", 45], ["2026-07-01", null], ["2026-07-02", null], ["2026-07-03", 11],
    ]);
  });
});

describe("rankTicks", () => {
  it("round ticks, never #61 / #121", () => {
    expect(rankTicks(240)).toEqual([1, 50, 100, 150, 200]);
    expect(rankTicks(60)).toEqual([1, 10, 20, 30, 40, 50, 60]);
  });
});

describe("tierOf / monthStarts", () => {
  it("puts each rank in its rarity zone, edges included", () => {
    expect([1, 10, 11, 50, 51, 100, 101, 250, 251, 999].map((r) => tierOf(r).key)).toEqual([
      "legendary", "legendary", "epic", "epic", "rare", "rare", "uncommon", "uncommon", "common", "common",
    ]);
  });
  it("one boundary per month change, never on the first day shown", () => {
    expect(monthStarts("2026-06-14", "2026-10-19")).toEqual(["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(monthStarts("2026-12-30", "2027-01-02")).toEqual(["2027-01-01"]);
    expect(monthStarts("2026-10-01", "2026-10-19")).toEqual([]);
  });
});

describe("lastDays", () => {
  it("keeps exactly the last N calendar days, ALL keeps everything", () => {
    const f = fillCalendar([{ day: "2026-09-01", rank: 95 }, { day: "2026-10-19", rank: 81 }]);
    expect(lastDays(f, 30).map((p) => p.day)[0]).toBe("2026-09-20");
    expect(lastDays(f, 30)).toHaveLength(30);
    expect(lastDays(f, 0)).toHaveLength(f.length);
  });
});

describe("liveSplit (reconstructed stretch, live record, fills)", () => {
  // career-ops: a reconstructed 12-13 Jun, live from 14 Jun; around the 3 Sep
  // truncated sweep the live record has 1 and 4-5 Sep, filled 2-3 Sep (real ranks)
  const pts = [
    { day: "2026-06-12", rank: 9, reconstructed: true },
    { day: "2026-06-13", rank: 12, reconstructed: true },
    { day: "2026-06-14", rank: 15 },
    { day: "2026-09-01", rank: 84 },
    { day: "2026-09-02", rank: 75, reconstructed: true },
    { day: "2026-09-03", rank: 97, reconstructed: true },
    { day: "2026-09-04", rank: 101 },
    { day: "2026-09-05", rank: 96 },
  ];

  it("a fill inside the live record is reconstructed but not 'pre'", () => {
    const s = liveSplit(pts);
    expect(s.firstLive).toBe("2026-06-14");
    expect(pts.filter((p) => s.isPre(p.day)).map((p) => p.day)).toEqual(["2026-06-12", "2026-06-13"]);
    expect(pts.filter(s.isFill).map((p) => p.day)).toEqual(["2026-09-02", "2026-09-03"]);
    expect(pts.filter(s.isRec).length).toBe(4);
  });

  it("the headline (last day, week over week) leaves the fills out", () => {
    const s = liveSplit(pts);
    expect(s.headline.map((p) => p.day)).not.toContain("2026-09-02");
    expect(s.headline).toHaveLength(6);
  });

  it("with no live day, everything is 'pre' and the headline is not blank", () => {
    const only = pts.filter((p) => p.reconstructed);
    const s = liveSplit(only);
    expect(s.firstLive).toBeNull();
    expect(s.headline).toHaveLength(4);
    expect(weekOverWeek(s.headline).lastDay).toBe("2026-09-03");
  });
});
