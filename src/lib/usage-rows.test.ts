import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildUsageRows } from "./usage-rows";
import { fmtUtcDay } from "./format";

const DAY = 864e5;
const dayKey = (i: number) => new Date(Date.parse("2026-06-02T00:00:00Z") + i * DAY).toISOString().slice(0, 10);

// The house repo's clone series on 2026-08-13: 72 days from Jun 2, per-day
// uniques summing to 91,685 while GitHub's deduplicated count was 29,837.
// Per-day split is spread evenly; the totals are the real ones.
const CLONE_DAYS = 72;
const U_SUM = 91_685;
const clones = Array.from({ length: CLONE_DAYS }, (_, i) => {
  const u = Math.floor(U_SUM / CLONE_DAYS) + (i < U_SUM % CLONE_DAYS ? 1 : 0);
  return { day: dayKey(i), u, c: u * 2 + (i % 3) };
});
const C_SUM = clones.reduce((s, x) => s + x.c, 0);

describe("buildUsageRows", () => {
  // 2026-08-13: the headline moved to clone events, the curve under it kept
  // summing per-day uniques and topped out at "92K".
  it("accumulates clone events (c), never per-day uniques (u)", () => {
    const rows = buildUsageRows([], clones);
    const last = rows[rows.length - 1];
    expect(clones.reduce((s, x) => s + x.u, 0)).toBe(U_SUM);
    expect(last.clonesCum).not.toBe(U_SUM);
    // the same figure the CLONES headline above the chart prints
    expect(last.clonesCum).toBe(C_SUM);
    expect(last.totalCum).toBe(C_SUM);
    expect(rows[0].clones).toBe(clones[0].c);
  });

  it("stacks npm installs under clone events on the common horizon", () => {
    const npm = clones.slice(0, 70).map((x) => ({ day: x.day, d: 100 }));
    const rows = buildUsageRows(npm, clones);
    // the curve stops at npm's last day (it publishes later than GitHub)
    expect(rows).toHaveLength(70);
    const last = rows[rows.length - 1];
    expect(last.npmCum).toBe(7_000);
    expect(last.clonesCum).toBe(clones.slice(0, 70).reduce((s, x) => s + x.c, 0));
    expect(last.totalCum).toBe(last.npmCum + last.clonesCum);
  });
});

describe("fmtUtcDay in an Americas time zone", () => {
  const tz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });
  afterAll(() => {
    process.env.TZ = tz;
  });

  // Day keys are UTC; formatted in the viewer's zone, every bar read one day
  // early west of Greenwich, and the server (UTC) disagreed with the client.
  it("labels each bar with its own UTC day", () => {
    expect(new Date(Date.parse("2026-08-13T00:00:00Z")).getDate()).toBe(12); // the zone is in effect
    const rows = buildUsageRows([], clones);
    for (const [i, r] of rows.entries()) expect(fmtUtcDay(r.t)).toBe(fmtUtcDay(clones[i].day));
    expect(fmtUtcDay(Date.parse("2026-08-13T00:00:00Z"))).toBe("Aug 13");
    expect(fmtUtcDay("2026-08-13")).toBe("Aug 13");
    expect(fmtUtcDay("2026-08-13", true)).toBe("Aug 13, 2026");
    expect(fmtUtcDay("not a day")).toBe("");
  });
});
