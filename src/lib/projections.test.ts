import { describe, expect, it } from "vitest";
import { ceilEta, etaText, neighborEtas, unsteadyLabel } from "@/lib/projections";

// The chart label under a rival: a doubtful rate says why instead of a date.
describe("neighborEtas carries the doubt to the label", () => {
  const NOW = Date.parse("2026-10-16T11:00:00Z");
  const hunter = { r: "chrislgarry/Apollo-11", s: 74753, v: 343, trend: "decay" as const, v7_to: "2026-10-16T00:25:00.000Z" };

  it("a cooling hunter reads 'cooling', not 'catches you in 2d'", () => {
    const [n] = neighborEtas([hunter], 75053, 174, { trend: null }, NOW);
    expect(n.catchDays).not.toBeNull();
    expect(n.unsteady).toEqual({ side: "b", why: "decay", bound: null });
    expect(unsteadyLabel(n.unsteady)).toBe("cooling");
  });

  it("our own acceleration while a hunter closes in is named as ours", () => {
    const [n] = neighborEtas([{ ...hunter, trend: null }], 75053, 174, { trend: "accel" }, NOW);
    expect(unsteadyLabel(n.unsteady)).toBe("we are accelerating");
  });

  it("our acceleration toward a rival ahead keeps the eta, as a ceiling rounded UP: 5.3d is 'eta ≤6d'", () => {
    const ahead = { r: "x/rival", s: 75099, v: 95.5, trend: null, v7_to: "2026-10-16T00:25:00.000Z" };
    const [n] = neighborEtas([ahead], 74799, 151.6, { trend: "accel" }, NOW);
    expect(unsteadyLabel(n.unsteady)).toBeNull();
    expect(n.etaDays).toBe(5.3);
    expect(etaText(n, n.etaDays)).toBe("≤6d");
  });

  it("a steady leader pulling away keeps its own word", () => {
    const [n] = neighborEtas([{ ...hunter, trend: null, s: 76000, v: 500 }], 75053, 174, {}, NOW);
    expect(n.receding).toBe(true);
    expect(n.unsteady).toBeNull();
  });

  // Real payload, 16-oct 11:28Z: Apollo-11 v7 335.5 but last day 150.6 (decay);
  // career-ops v7 176, last day 364.9 (accel). "pulling away" was false that day.
  it("a cooling leader is not 'pulling away': Apollo-11 on 16-oct", () => {
    const apollo = { r: "chrislgarry/Apollo-11", s: 75285, v: 335.5, trend: "decay" as const, v7_to: "2026-10-16T11:28:12.000Z" };
    const [n] = neighborEtas([apollo], 75149, 176, { trend: "accel" }, NOW);
    expect(n.receding).toBe(true);
    expect(unsteadyLabel(n.unsteady)).toBe("cooling");
  });

  it("our acceleration behind a steady leader is named as ours", () => {
    const lead = { r: "x/lead", s: 75285, v: 335.5, trend: null, v7_to: "2026-10-16T11:28:12.000Z" };
    const [n] = neighborEtas([lead], 75149, 176, { trend: "accel" }, NOW);
    expect(unsteadyLabel(n.unsteady)).toBe("we are accelerating");
  });
});

describe("a ceiling rounds up in its own unit", () => {
  const up = { confidence: "upper" as const, etaRange: null };
  it("hours, days and the date all use the ceiling", () => {
    expect(etaText(up, 0.21)).toBe("≤6h"); // 5.04 h
    expect(etaText(up, 2.01)).toBe("≤3d");
    expect(etaText(up, 61)).toBe("≤3mo");
    expect(ceilEta(5.3)).toBe(6);
    expect(ceilEta(0.21)).toBeCloseTo(6 / 24, 10);
  });
});
