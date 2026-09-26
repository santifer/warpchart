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
