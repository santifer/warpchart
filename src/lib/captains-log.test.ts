import { describe, expect, it } from "vitest";
import { captainsLog } from "./events";

// Incident 2026-11-03 (14th deck review): the log's summary read "Day 214:
// +330 stars ... Holding rank #225" while the KPI strip on the same screen
// said TODAY 184 and RANK #224. The figures were yesterday's close and a
// cached rank, with nothing saying so.
const days = [
  { d: "2026-10-31", c: 250 },
  { d: "2026-11-01", c: 221 },
  { d: "2026-11-02", c: 330 },
  { d: "2026-11-03", c: 184 }, // today, still open
];

describe("captainsLog", () => {
  it("dates the closed day it reports", () => {
    expect(captainsLog(days)).toMatch(/^Nov 2 close · /);
  });
  it("reports the closed day's count and its change", () => {
    expect(captainsLog(days)).toContain("+330 stars, +49% vs the day before");
  });
  it("prints no rank, which the live strip already shows and can differ", () => {
    expect(captainsLog(days)).not.toMatch(/rank/i);
  });
  it("needs three days", () => {
    expect(captainsLog(days.slice(0, 2))).toBeNull();
  });
});
