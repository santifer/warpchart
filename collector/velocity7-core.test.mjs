import { describe, expect, it } from "vitest";
import { v7For, measureRepo, pointMs, v7Stamp, trendOf } from "./velocity7-core.mjs";

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

// Real rank-history payloads (route-history shards, pulled 2026-10-16). Each
// day was recorded by the first collector run after 00:00Z (~00:25Z).
const RUFLO = [
  ["2026-10-08", 74093], ["2026-10-09", 74142], ["2026-10-10", 74218], ["2026-10-11", 74303],
  ["2026-10-12", 74374], ["2026-10-13", 74474], ["2026-10-14", 74566], ["2026-10-15", 74707],
  ["2026-10-16", 75112],
];
const APOLLO = [
  ["2026-10-03", 72469], ["2026-10-04", 72473], ["2026-10-05", 72482], ["2026-10-06", 72480],
  ["2026-10-07", 72482], ["2026-10-08", 72531], ["2026-10-09", 72782], ["2026-10-10", 73256],
  ["2026-10-11", 73750], ["2026-10-12", 74385], ["2026-10-13", 74772], ["2026-10-14", 74965],
  ["2026-10-15", 75065], ["2026-10-16", 75183],
];
const capturedAtOf = (pairs, hhmm = "00:25") =>
  Object.fromEntries(pairs.map(([d]) => [d, `${d}T${hhmm}:00.000Z`]));
// the registry (route.json) as served on 2026-10-16: refreshed 2026-10-15T11:20Z
const ROUTE_AT = Date.parse("2026-10-15T11:20:12Z");

describe("measureRepo: the window closes on the newest point (2026-10-16)", () => {
  it("ruflo: uses the day recorded at 00:25Z on the 16th, not the registry from the 15th (it read 95.5/d)", () => {
    const r = measureRepo({ stars: 74759, routeAtMs: ROUTE_AT }, series(RUFLO), capturedAtOf(RUFLO));
    expect(r.v7).toBeGreaterThan(120);
    expect(r.v7).toBeLessThan(160);
    expect(r.v7).toBe(138.6); // (75112 - 74142) / 7 days, capture to capture
    expect(r.v7_to).toBe("2026-10-16T00:25:00.000Z");
    expect(r.v1).toBe(405); // 75112 - 74707 over exactly one day
    expect(r.trend).toBe("accel");
  });

  it("Apollo-11: a wave that is over reads as decay, not as a 343/d pace", () => {
    const r = measureRepo({ stars: 75085, routeAtMs: ROUTE_AT }, series(APOLLO), capturedAtOf(APOLLO));
    expect(r.trend).toBe("decay");
    expect(r.v7).toBeGreaterThan(300); // the wave really happened inside the window
    expect(r.v1).toBe(118);
  });

  it("closes on the registry when it is newer than the last recorded day", () => {
    const pairs = RUFLO.slice(0, -1); // the 16th not recorded yet
    const r = measureRepo({ stars: 74759, routeAtMs: ROUTE_AT }, series(pairs), capturedAtOf(pairs));
    expect(r.v7_to).toBe("2026-10-15T11:20:12.000Z");
    expect(r.v7).toBeGreaterThan(0);
  });

  it("v1 is null when there is no point about a day before the end (a gap is not a day)", () => {
    const gappy = [["2026-10-09", 74142], ["2026-10-13", 74474], ["2026-10-16", 75112]];
    const r = measureRepo({ stars: 74759, routeAtMs: ROUTE_AT }, series(gappy), capturedAtOf(gappy));
    expect(r.v1).toBeNull();
    expect(r.trend).toBeNull();
  });

  it("names the day of a step between the last two recorded days (not 'today')", () => {
    const purged = [...beforePurge.slice(0, 6), ["2026-07-24", 78800]];
    const r = measureRepo({ stars: 100600, routeAtMs: Date.parse("2026-07-23T11:00:00Z") }, series(purged), capturedAtOf(purged));
    expect(r).toMatchObject({ v7: 0, purge: "2026-07-24", measured: false, trend: null });
  });
});

describe("v1 is not a pace on a correction day", () => {
  it("odysseus: the restore day (+21,863 giving back the 24th's drop) reads v1 null, not +21,863/d", () => {
    const withRestore = [
      ...beforePurge,
      ["2026-07-27", 79160], ["2026-07-28", 79280], ["2026-07-29", 101143],
    ];
    const r = measureRepo({ stars: 79280, routeAtMs: Date.parse("2026-07-28T11:00:00Z") }, series(withRestore), capturedAtOf(withRestore));
    expect(r.v7_to).toBe("2026-07-29T00:25:00.000Z");
    expect(r.v1).toBeNull();
    expect(r.trend).toBeNull();
  });

  it("a viral rise with no earlier drop to give back keeps its v1", () => {
    const viral = [["2026-09-04", 10150], ["2026-09-05", 13150]];
    const r = measureRepo({ stars: 10150, routeAtMs: Date.parse("2026-09-04T11:00:00Z") }, series(viral), capturedAtOf(viral));
    expect(r.v1).toBe(3000);
  });
});

describe("pointMs and the v7 stamp", () => {
  it("ruflo with ONE known capture (the real Blob on 2026-10-16): v1 is a day, ~405/d, not 782", () => {
    const only16 = { "2026-10-16": "2026-10-16T00:24:58.644Z" };
    const r = measureRepo({ stars: 74759, routeAtMs: ROUTE_AT }, series(RUFLO), only16);
    expect(r.v1).toBeGreaterThan(395);
    expect(r.v1).toBeLessThan(415);
    expect(r.v7).toBeCloseTo(138.6, 0);
  });

  it("an unstamped day takes the time of day of the latest known capture", () => {
    expect(pointMs("2026-10-15", { "2026-10-16": "2026-10-16T00:24:58.644Z" })).toBe(Date.parse("2026-10-15T00:24:58.644Z"));
  });

  it("dates a day by its capture, falling back to noon only when no capture time is known", () => {
    expect(pointMs("2026-10-16", { "2026-10-16": "2026-10-16T00:24:58.644Z" })).toBe(Date.parse("2026-10-16T00:24:58.644Z"));
    expect(pointMs("2026-10-16", {})).toBe(noon("2026-10-16"));
    expect(pointMs("2026-10-16", { "2026-10-16": "2026-10-17T00:24:58Z" })).toBe(noon("2026-10-16"));
  });

  it("moves when a day is recorded after the registry refresh, so velocity7 recomputes", () => {
    expect(v7Stamp("2026-10-15T11:20:12Z", "2026-10-16T00:24:58.644Z")).toBe("2026-10-16T00:24:58.644Z");
    expect(v7Stamp("2026-10-16T11:20:12Z", "2026-10-16T00:24:58.644Z")).toBe("2026-10-16T11:20:12Z");
    expect(v7Stamp("2026-10-16T11:20:12Z", null)).toBe("2026-10-16T11:20:12Z");
  });
});

describe("trend needs a real difference, not just a ratio", () => {
  // typicode/json-server, route-history 2026-10-09..16 (real payload): a day of 0
  // against a week of ~0.9/d is a ratio of 0, and it read "decay"
  const JSON_SERVER = [
    ["2026-10-09", 75722], ["2026-10-10", 75724], ["2026-10-11", 75721], ["2026-10-12", 75723],
    ["2026-10-13", 75729], ["2026-10-14", 75730], ["2026-10-15", 75728], ["2026-10-16", 75728],
  ];
  it("json-server: a slow repo's day-to-day noise is not a trend", () => {
    const r = measureRepo({ stars: 75728, routeAtMs: ROUTE_AT }, series(JSON_SERVER), capturedAtOf(JSON_SERVER));
    expect(r.v1).toBe(0);
    expect(r.trend).toBeNull();
  });
  it("keeps the trend when the difference is large (Apollo-11: 118 vs 343)", () => {
    expect(trendOf(118, 343)).toBe("decay");
    expect(trendOf(0, 0.9)).toBeNull();
    expect(trendOf(40, 16)).toBe(null); // ratio 2.5 but only +24/d
  });
});
