import { describe, expect, it } from "vitest";
import { pickAdoption } from "./vitals";

describe("pickAdoption", () => {
  // A vitals Blob written before the collector's fix carries the week's summed
  // per-day uniques; /api/v1/dossier passed `adoption` through untouched.
  it("never lets the summed per-day uniques through", () => {
    const old = { cloneConvPct: 41, uniqueClonersWeek: 8912, clonesPerCloner: 1.9 };
    expect(pickAdoption(old)).toEqual({ cloneConvPct: 41, clonesWeek: null });
    expect(pickAdoption({ cloneConvPct: null, clonesWeek: 18_200 })).toEqual({ cloneConvPct: null, clonesWeek: 18_200 });
    expect(pickAdoption(null)).toBeNull();
  });
});
