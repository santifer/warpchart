import { describe, expect, it } from "vitest";
import { projectCrossing } from "@/lib/compare";

describe("projectCrossing (the single crossing math)", () => {
  it("projects a converging pair", () => {
    const c = projectCrossing(1000, 50, 1100, 10);
    expect(c).toMatchObject({ gap: 100, closing: 40, etaDays: 2.5, confidence: "firm", etaRange: null });
  });

  it("marks a firm ETA only when the closing speed is real and the date is near", () => {
    expect(projectCrossing(1000, 120, 1300, 20).confidence).toBe("firm"); // 3 days at 100/day
    expect(projectCrossing(1000, 60, 1600, 10).confidence).toBe("soft"); // 12 days
    expect(projectCrossing(1000, 60, 1600, 10).etaRange).toEqual({ min: 7, max: 17 }); // ±40%, whole days
  });

  it("returns no meeting for a parallel or diverging pair", () => {
    expect(projectCrossing(1000, 10, 1100, 50).etaDays).toBeNull();
    expect(projectCrossing(1000, 10, 1100, 10).etaDays).toBeNull();
  });

  it("does not invent a meeting from a sub-rounding closing speed", () => {
    expect(projectCrossing(1000, 10.04, 1100, 10).etaDays).toBeNull();
  });

  it("is symmetric about who is behind", () => {
    const ab = projectCrossing(1000, 50, 1100, 10);
    const ba = projectCrossing(1100, 10, 1000, 50);
    expect(ba.etaDays).toBe(ab.etaDays);
  });

  // Incident 27-jul: a star purge inside the 7-day window read as -2903 stars/day
  // and turned a months-away crossing into "tomorrow". A negative rate that big
  // is a correction, not growth; this pins what the math does with it so the
  // guard upstream (velocity7 purge detection) stays necessary and visible.
  it("shows why a purge must never reach it as a rate", () => {
    const poisoned = projectCrossing(1000, 10, 1100, -2903);
    expect(poisoned.etaDays).toBeLessThan(0.1);
  });
});

// 2026-10-16: career-ops-hq/career-ops (74,799★, v7 151.6) vs ruvnet/ruflo
// (74,759★, v7 95.5) and chrislgarry/Apollo-11 (75,085★, v7 366.3 from a wave
// that was over: 76-140/d that day). Every eta came out with no doubt attached.
describe("projectCrossing: a shifting or stale rate is not a pace to project", () => {
  const NOW = Date.parse("2026-10-16T11:00:00Z");
  const FRESH = "2026-10-16T00:25:00.000Z";

  it("is noisy when the rival's rate is a wave that is over (Apollo-11, decay)", () => {
    // us (75,053★ at 174/d) with an Apollo-shaped hunter 300★ behind at its
    // wave-inflated 343/d: without the doubt this is a firm ~2-day catch
    expect(projectCrossing(75053, 174, 74753, 343).confidence).toBe("firm");
    const x = projectCrossing(75053, 174, 74753, 343, {
      a: { trend: null, asOf: FRESH }, b: { trend: "decay", asOf: FRESH }, nowMs: NOW,
    });
    // it chases us and is cooling: the catch can only come LATER, or never
    expect(x.confidence).toBe("noisy");
    expect(x.unsteady).toEqual({ side: "b", why: "decay", bound: null });
  });

  it("we accelerate while closing on a rival ahead: the v7 eta is a ceiling ('upper', not 'no firm eta')", () => {
    // career-ops (74,799, v7 151.6, accel) behind a 300★-ahead rival at 95.5/d
    const x = projectCrossing(74799, 151.6, 75099, 95.5, { a: { trend: "accel" }, b: {}, nowMs: NOW });
    expect(x.confidence).toBe("upper");
    expect(x.etaDays).toBe(5.3);
    expect(x.etaRange).toBeNull();
    expect(x.unsteady).toEqual({ side: "a", why: "accel", bound: "upper" });
  });

  it("a rival cooling while we close on it is also a ceiling", () => {
    const x = projectCrossing(74799, 151.6, 75099, 95.5, { a: {}, b: { trend: "decay" }, nowMs: NOW });
    expect(x.confidence).toBe("upper");
  });

  it("a rival accelerating while we close on it can push the meeting out: noisy", () => {
    const x = projectCrossing(74799, 151.6, 75099, 95.5, { a: { trend: "accel" }, b: { trend: "accel" }, nowMs: NOW });
    expect(x.confidence).toBe("noisy");
    expect(x.unsteady).toEqual({ side: "b", why: "accel", bound: null });
  });

  it("an accelerating hunter makes its catch a ceiling; us cooling too", () => {
    expect(projectCrossing(75053, 174, 74753, 343, { b: { trend: "accel" }, nowMs: NOW }).confidence).toBe("upper");
    expect(projectCrossing(75053, 174, 74753, 343, { a: { trend: "decay" }, nowMs: NOW }).confidence).toBe("upper");
    // ...but us accelerating away from it can stretch or cancel the catch
    expect(projectCrossing(75053, 174, 74753, 343, { a: { trend: "accel" }, nowMs: NOW }).confidence).toBe("noisy");
  });

  it("is noisy when a window closed more than 26 h ago (the v7 served on the 16th closed on the 15th 11:20Z)", () => {
    const x = projectCrossing(74759, 300, 74799, 151.6, {
      a: { asOf: FRESH }, b: { asOf: "2026-10-15T08:00:00Z" }, nowMs: NOW,
    });
    expect(x.confidence).toBe("noisy");
    expect(x.unsteady).toEqual({ side: "b", why: "stale", bound: null });
  });

  it("stays firm with two steady, fresh rates", () => {
    const x = projectCrossing(1000, 120, 1300, 20, { a: { asOf: FRESH }, b: { asOf: FRESH }, nowMs: NOW });
    expect(x.confidence).toBe("firm");
    expect(x.unsteady).toBeNull();
  });
});
