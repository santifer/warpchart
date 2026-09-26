import { describe, expect, it } from "vitest";
import { COLLECTOR_STALE_H, pageMark } from "@/lib/staleness";

describe("collector staleness", () => {
  // 26-sep 14:17Z: the snapshot was 194 minutes old in a perfectly normal
  // cycle, and the phone got "warpchart collector quiet".
  it("does not page on a normal gap (the real cadence is ~5 h, up to ~8 h)", () => {
    for (const min of [194, 300, 360, 480]) expect(pageMark(min)).toBeNull();
  });

  it("pages once when a gap turns into a real hole, and again at 16 h and 24 h", () => {
    expect(pageMark(COLLECTOR_STALE_H * 60 + 5)).toBe(600);
    expect(pageMark(16 * 60 + 10)).toBe(960);
    expect(pageMark(24 * 60)).toBe(1440);
    expect(pageMark(COLLECTOR_STALE_H * 60 + 45)).toBeNull(); // outside the window: no repeat
  });

  it("catches the real holes of September (13 h and 25 h)", () => {
    // distinct marks reached over a gap of `hours`, sampled like the 30-min cron
    const pagesIn = (hours: number) =>
      new Set(Array.from({ length: hours * 2 + 1 }, (_, i) => pageMark(i * 30)).filter((m) => m !== null)).size;
    expect(pagesIn(13)).toBeGreaterThanOrEqual(1);
    expect(pagesIn(25)).toBe(3);
  });
});
