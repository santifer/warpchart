import { describe, expect, it } from "vitest";
import { v7For } from "./velocity7-core.mjs";

const DAY = 864e5;
const noon = (d) => Date.parse(`${d}T12:00:00Z`);
// [isoDay, rank, stars] per day, as the rank-history shards store them
const series = (pairs) => pairs.map(([d, s]) => [d, 100, s]);

// odysseus-dev/odysseus, July 2026: growing ~120/d, then GitHub removed 21.8k
// farmed stars on the 24th and gave them back on the 29th.
const beforePurge = [
  ["2026-07-18", 100000], ["2026-07-19", 100120], ["2026-07-20", 100240], ["2026-07-21", 100360],
  ["2026-07-22", 100480], ["2026-07-23", 100600], ["2026-07-24", 78800], ["2026-07-25", 78920],
  ["2026-07-26", 79040],
];

describe("v7For: a step is a correction, not growth", () => {
  it("measures only after a purge (it read -2903/d before the fix)", () => {
    const today = noon("2026-07-27");
    const r = v7For(79160, series(beforePurge), today - 7 * DAY, today);
    expect(r).toEqual({ v7: 120, purge: "2026-07-24", measured: true });
  });

  it("treats the restore as the same kind of step (it read +4587/d)", () => {
    const withRestore = [
      ...beforePurge,
      ["2026-07-27", 79160], ["2026-07-28", 79280], ["2026-07-29", 101143], ["2026-07-30", 101263],
    ];
    const today = noon("2026-07-31");
    const r = v7For(101383, series(withRestore), today - 7 * DAY, today);
    expect(r).toEqual({ v7: 120, purge: "2026-07-29", measured: true });
  });

  it("does not mistake honest viral growth for a step", () => {
    const viral = series([
      ["2026-09-01", 10000], ["2026-09-02", 10050], ["2026-09-03", 10100], ["2026-09-04", 10150],
      ["2026-09-05", 13150], ["2026-09-06", 13200], ["2026-09-07", 13250],
    ]);
    const today = noon("2026-09-08");
    const r = v7For(13300, viral, today - 7 * DAY, today);
    expect(r.purge).toBeNull();
    expect(r.v7).toBeGreaterThan(400); // the front page really happened
  });

  it("reports no usable baseline when the step lands between the last day and now", () => {
    const today = noon("2026-07-24");
    const r = v7For(78800, series(beforePurge.slice(0, 6)), today - 7 * DAY, today);
    expect(r).toEqual({ v7: 0, purge: "today", measured: false });
  });

  // the paths the refactor re-wired in velocity7.mjs, pinned one by one
  it("falls back to 0 with purge 'unknown' when a step the series cannot show pushes the rate past 5%/day", () => {
    const flat = series([
      ["2026-09-01", 1000], ["2026-09-02", 1000], ["2026-09-03", 1000], ["2026-09-04", 1000],
      ["2026-09-05", 1000], ["2026-09-06", 1000], ["2026-09-07", 1000],
    ]);
    const today = noon("2026-09-08");
    // +20k since last week with no recorded step (a gap, a rename): impossible organically
    expect(v7For(21000, flat, today - 7 * DAY, today)).toEqual({ v7: 0, purge: "unknown", measured: true });
  });

  it("leaves the rate alone (undefined) when the baseline is shorter than a day and nothing was purged", () => {
    // the only recorded point is 0.7 days old: usable (older than half a day) but too short to measure
    const today = noon("2026-09-07") + 0.7 * DAY;
    const r = v7For(1010, series([["2026-09-07", 1000]]), today - 7 * DAY, today);
    expect(r).toEqual({ v7: undefined, purge: null, measured: false });
  });

  it("returns null when there is no usable point at all", () => {
    const today = noon("2026-09-08");
    expect(v7For(1000, series([["2026-09-08", 1000]]), today - 7 * DAY, today)).toBeNull();
  });
});
