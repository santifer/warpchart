import { describe, it, expect } from "vitest";
import { rankDelta7d, weekOverWeekPct } from "./deck-deltas";

const DAY = 864e5;
const NOW = Date.UTC(2026, 10, 3, 12); // 3-nov-2026 12:00Z

describe("rankDelta7d", () => {
  it("counts positions gained against the newest snapshot at or before now-7d", () => {
    const h = [
      { t: NOW - 9 * DAY, rank: 240 },
      { t: NOW - 7.5 * DAY, rank: 232 },
      { t: NOW - 6 * DAY, rank: 229 }, // inside the week: not the baseline
    ];
    expect(rankDelta7d(h, 225, NOW)).toBe(7); // 232 -> 225
  });

  it("is negative when the repo fell", () => {
    expect(rankDelta7d([{ t: NOW - 7 * DAY, rank: 220 }], 225, NOW)).toBe(-5);
  });

  it("is null without a snapshot 7-8 days back, never zero", () => {
    expect(rankDelta7d([{ t: NOW - 20 * DAY, rank: 300 }], 225, NOW)).toBeNull();
    expect(rankDelta7d([{ t: NOW - 2 * DAY, rank: 230 }], 225, NOW)).toBeNull();
    expect(rankDelta7d([], 225, NOW)).toBeNull();
    expect(rankDelta7d([{ t: NOW - 7 * DAY, rank: 230 }], null, NOW)).toBeNull();
  });
});

describe("weekOverWeekPct", () => {
  const days = (n: number, c: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => ({
      d: new Date(NOW - (n - i) * DAY).toISOString().slice(0, 10),
      c: c(i),
    }));

  it("compares the last 7 complete days with the 7 before", () => {
    // 7 days of 100 then 7 days of 150 -> +50 %
    expect(weekOverWeekPct(days(14, (i) => (i < 7 ? 100 : 150)), NOW)).toBe(50);
  });

  it("leaves today's partial day out of both windows", () => {
    const series = [...days(14, () => 100), { d: "2026-11-03", c: 3 }];
    expect(weekOverWeekPct(series, NOW)).toBe(0);
  });

  it("is null with fewer than 14 complete days or an empty prior week", () => {
    expect(weekOverWeekPct(days(10, () => 100), NOW)).toBeNull();
    expect(weekOverWeekPct(days(14, (i) => (i < 7 ? 0 : 50)), NOW)).toBeNull();
  });
});
