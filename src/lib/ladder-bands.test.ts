import { describe, expect, it } from "vitest";
import { bandAreas, bandFor, monthlyTierBands, zoneOf, type BandDay } from "./ladder-bands";

// A day of the table whose 10th / 50th / 100th / 250th gains are the given
// cut-offs (the rest only has to stay sorted, highest first).
function day(d: string, cut: [number, number, number, number], opts: { n?: number; hours?: number | null; len?: number } = {}): BandDay {
  const [t10, t50, t100, t250] = cut;
  const len = opts.len ?? 1000;
  const gains = Array.from({ length: len }, (_, i) =>
    i < 10 ? t10 + (9 - i) : i < 50 ? t50 + Math.round(((t10 - t50) * (49 - i)) / 40) : i < 100 ? t100 + Math.round(((t50 - t100) * (99 - i)) / 50) : i < 250 ? t250 + Math.round(((t100 - t250) * (249 - i)) / 150) : t250 - 1,
  );
  return { day: d, n: opts.n ?? len, gains, hours: opts.hours ?? null };
}
const month = (m: string, cut: [number, number, number, number], count: number) =>
  Array.from({ length: count }, (_, i) => day(`${m}-${String(i + 1).padStart(2, "0")}`, cut));

// The real table, 17-25 Oct 2026 (velocity-rank/2026-10.json): day, n, window
// hours, then the 10th/50th/100th/250th gains. The first stamped windows ran
// from 19.9 h to 28.1 h.
const REAL: [string, number, number, [number, number, number, number]][] = [
  ["2026-10-17", 1000, 28, [1141, 310, 134, 41]],
  ["2026-10-18", 1000, 24.2, [897, 319, 121, 43]],
  ["2026-10-19", 999, 24.2, [1097, 338, 150, 50]],
  ["2026-10-20", 1000, 19.9, [907, 268, 123, 35]],
  ["2026-10-21", 998, 28.1, [1084, 393, 175, 49]],
  ["2026-10-22", 1000, 20, [700, 272, 134, 41]],
  ["2026-10-23", 1000, 27.8, [898, 343, 152, 49]],
  ["2026-10-24", 1000, 24.1, [719, 276, 132, 40]],
  ["2026-10-25", 1000, 24.1, [868, 298, 148, 47]],
];
const realDays = REAL.map(([d, n, h, cut]) => day(d, cut, { n, hours: h }));

describe("monthlyTierBands", () => {
  it("scales each day's cut-offs to 24 h before the median (real windows of 19.9 h and 28.1 h)", () => {
    // raw top-100 cut-offs 123 (19.9 h) and 175 (28.1 h) are 42% apart; per 24 h
    // they are 148 and 149: the gap was the window, not the market
    const two = monthlyTierBands(realDays.filter((d) => d.day === "2026-10-20" || d.day === "2026-10-21"), { top: 1000, through: "2026-10-26" });
    expect(two).toEqual([]); // two days are not a month
    const b = monthlyTierBands(realDays, { top: 1000, through: "2026-10-26" });
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ month: "2026-10", from: "2026-10-17", to: "2026-10-31", basis: "month", days: 9 });
    // per-24h top-100 cut-offs of the nine days: 115 120 131 131 [147] 148 149 149 161
    expect(b[0].t.rare).toBe(147);
    expect(b[0].t.uncommon).toBe(42);
  });

  it("keeps the zones ordered: top 10 above top 50 above top 100 above top 250", () => {
    const [b] = monthlyTierBands(realDays, { top: 1000, through: "2026-10-26" });
    expect(b.t.legendary).toBeGreaterThan(b.t.epic);
    expect(b.t.epic).toBeGreaterThan(b.t.rare);
    expect(b.t.rare).toBeGreaterThan(b.t.uncommon);
  });

  it("one band per month, each from its own days, the first starting on the record's first day", () => {
    const b = monthlyTierBands([...month("2026-08", [600, 200, 100, 33], 31).slice(13), ...month("2026-09", [580, 202, 100, 33], 30)], {
      top: 1000,
      through: "2026-09-30",
    });
    expect(b.map((x) => [x.month, x.from, x.to, x.basis, x.t.rare])).toEqual([
      ["2026-08", "2026-08-14", "2026-08-31", "month", 100],
      ["2026-09", "2026-09-01", "2026-09-30", "month", 100],
    ]);
  });

  it("leaves out a truncated sweep and a broken window instead of reading their cut-offs", () => {
    const days = [
      ...month("2026-09", [580, 200, 100, 33], 10),
      day("2026-09-11", [90, 30, 12, 4], { n: 400, len: 400 }), // partial sweep: low k-th gains
      day("2026-09-12", [99, 33, 17, 5], { len: 200 }), // no 250th gain at all
      day("2026-09-13", [5000, 1500, 800, 200], { hours: 3 }), // a 3-hour "day"
    ];
    const [b] = monthlyTierBands(days, { top: 1000, through: "2026-09-30" });
    expect(b.days).toBe(10);
    expect(b.t.rare).toBe(100);
  });

  it("a new month borrows the 30 days up to its last measured day, so today has its zone from the 1st", () => {
    const days = [...month("2026-10", [770, 270, 120, 40], 31)];
    // 1 Nov: the table's last day is still 31 Oct, the ladder already draws 1 Nov
    const b = monthlyTierBands(days, { top: 1000, through: "2026-11-01" });
    expect(b.map((x) => [x.month, x.basis, x.days, x.t.rare])).toEqual([
      ["2026-10", "month", 31, 120],
      ["2026-11", "trailing30", 30, 120],
    ]);
    // 3 Nov with two November days: still trailing, the new days included
    const b2 = monthlyTierBands([...days, ...month("2026-11", [900, 300, 160, 50], 2)], { top: 1000, through: "2026-11-03" });
    expect(b2[1]).toMatchObject({ month: "2026-11", basis: "trailing30", days: 30 });
    // 8 Nov with seven November days: the month stands on its own
    const b3 = monthlyTierBands([...days, ...month("2026-11", [900, 300, 160, 50], 7)], { top: 1000, through: "2026-11-08" });
    expect(b3[1]).toMatchObject({ month: "2026-11", basis: "month", days: 7, t: { rare: 160 } });
  });

  it("a table that stopped updating leaves the new month without a zone, never repaints old cut-offs", () => {
    const days = month("2026-10", [770, 270, 120, 40], 20); // last day 20 Oct
    const b = monthlyTierBands(days, { top: 1000, through: "2026-12-05" });
    expect(b.map((x) => x.month)).toEqual(["2026-10"]);
    // review 26-oct: stopped on 26 Oct and read on 28 Nov, November borrowed
    // October's tail for the whole month, because the week was counted from
    // the month's start and never from today
    const late = monthlyTierBands(month("2026-10", [770, 270, 120, 40], 26), { top: 1000, through: "2026-11-28" });
    expect(late.map((x) => x.month)).toEqual(["2026-10"]);
    // stopped on 3 Nov (three November days), read on 28 Nov: same
    const early = monthlyTierBands([...month("2026-10", [770, 270, 120, 40], 31), ...month("2026-11", [900, 300, 160, 50], 3)], {
      top: 1000,
      through: "2026-11-28",
    });
    expect(early.map((x) => x.month)).toEqual(["2026-10"]);
  });

  it("a day stored twice counts once", () => {
    const five = realDays.slice(0, 5);
    expect(monthlyTierBands([...five, ...five], { top: 1000, through: "2026-10-26" })).toEqual([]);
  });

  it("no measurable day, no band (never zones at zero)", () => {
    expect(monthlyTierBands([], { top: 1000, through: "2026-10-26" })).toEqual([]);
    expect(monthlyTierBands([day("2026-10-01", [9, 5, 3, 1], { n: 100, len: 100 })], { top: 1000, through: "2026-10-26" })).toEqual([]);
  });
});

describe("zoneOf / bandFor", () => {
  const [b] = monthlyTierBands(month("2026-10", [770, 270, 120, 40], 31), { top: 1000, through: "2026-10-31" });
  it("names the zone a day's stars fall in, cut-offs inclusive", () => {
    expect(zoneOf(800, b)).toBe("legendary");
    expect(zoneOf(270, b)).toBe("epic");
    expect(zoneOf(186, b)).toBe("rare");
    expect(zoneOf(40, b)).toBe("uncommon");
    expect(zoneOf(39, b)).toBe("common");
  });
  it("finds a day's month band, and none outside the record", () => {
    expect(bandFor("2026-10-26", [b])?.month).toBe("2026-10");
    expect(bandFor("2026-09-30", [b])).toBeNull();
  });
});

describe("bandAreas", () => {
  const bands = monthlyTierBands([...month("2026-09", [580, 200, 100, 33], 30), ...month("2026-10", [770, 270, 120, 40], 31)], {
    top: 1000,
    through: "2026-10-31",
  });
  const rows = (from: string, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.parse(`${from}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10);
      return { d, label: d.slice(5).replace("-", "/") };
    });

  it("splits at the month boundary, from the first to the last visible day of each month", () => {
    const a = bandAreas(rows("2026-09-25", 10), bands, 300);
    const sep = a.filter((x) => x.key.startsWith("2026-09"));
    const oct = a.filter((x) => x.key.startsWith("2026-10"));
    expect(sep.every((x) => x.x1 === "09/25" && x.x2 === "09/30")).toBe(true);
    expect(oct.every((x) => x.x1 === "10/01" && x.x2 === "10/04")).toBe(true);
  });

  it("clips the zones to the axis top: a quiet window shows the lower zones only", () => {
    const a = bandAreas(rows("2026-10-10", 7), bands, 150);
    expect(a.map((x) => [x.tier, x.y1, x.y2])).toEqual([
      ["rare", 120, 150],
      ["uncommon", 40, 120],
    ]);
  });

  it("a tall window shows every zone, legendary up to the top", () => {
    const a = bandAreas(rows("2026-10-10", 7), bands, 1000);
    expect(a.map((x) => [x.tier, x.y1, x.y2])).toEqual([
      ["legendary", 770, 1000],
      ["epic", 270, 770],
      ["rare", 120, 270],
      ["uncommon", 40, 120],
    ]);
  });

  it("draws nothing where no band exists (before the record began)", () => {
    expect(bandAreas(rows("2026-06-01", 30), bands, 500)).toEqual([]);
  });
});
