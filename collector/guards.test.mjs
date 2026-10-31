import { describe, expect, it } from "vitest";
import { acceptDistribution, acceptPrCount, acceptUniverse } from "./guards.mjs";

describe("acceptUniverse: a truncated day is never recorded as a day", () => {
  // the two short days that inflated every percentile in September 2026
  it.each([
    [4039, "2026-09-03"],
    [6012, "2026-09-11"],
  ])("refuses %i of 10,000 (%s)", (got) => {
    expect(acceptUniverse(got, { want: 10000 }).ok).toBe(false);
  });

  it("accepts a normal sweep", () => {
    expect(acceptUniverse(9995, { want: 10000, prev: 10000 })).toEqual({ ok: true, reason: null });
  });

  it("refuses the route.json fallback (1,000) as a top-10k day", () => {
    expect(acceptUniverse(1000, { want: 10000 }).ok).toBe(false);
  });

  it("refuses a sharp drop against the last accepted day even without a nominal target", () => {
    expect(acceptUniverse(2500, { prev: 3000 }).ok).toBe(false);
    expect(acceptUniverse(2950, { prev: 3000 }).ok).toBe(true);
  });

  // route.json: ten search pages of 100. One that fails or answers short used
  // to publish a registry with every rank below the hole off by a page.
  it("refuses a top-1000 registry whose last pages never came back", () => {
    expect(acceptUniverse(700, { want: 1000, prev: 1000 }).ok).toBe(false);
    expect(acceptUniverse(999, { want: 1000, prev: 1000 }).ok).toBe(true);
  });

  it("refuses an empty or broken count", () => {
    expect(acceptUniverse(0, { want: 3000 }).ok).toBe(false);
    expect(acceptUniverse(Number.NaN, { want: 3000 }).ok).toBe(false);
  });
});

describe("acceptPrCount: a full recompute cannot lose PRs", () => {
  it("refuses a flow built from a pagination that stopped early", () => {
    expect(acceptPrCount(1200, 2634).ok).toBe(false);
  });

  it("tolerates the rare deleted spam PR, with an absolute floor for small repos", () => {
    expect(acceptPrCount(2600, 2634).ok).toBe(true); // -34 of 2634 (< 2%)
    expect(acceptPrCount(142, 150).ok).toBe(true); // -8 < 10 floor
    expect(acceptPrCount(130, 150).ok).toBe(false);
  });

  // Review catch: a REAL drop (a spam purge in Hacktoberfest) must not freeze the panel forever.
  it("accepts a real drop once the same count repeats on the next run", () => {
    expect(acceptPrCount(2500, 2634).ok).toBe(false);
    expect(acceptPrCount(2500, 2634, { pendingGot: 2500 }).ok).toBe(true);
    expect(acceptPrCount(2480, 2634, { pendingGot: 2500 }).ok).toBe(false);
  });

  it("accepts the first run (nothing to compare with)", () => {
    expect(acceptPrCount(2634, null).ok).toBe(true);
  });
});

describe("acceptDistribution: Vital Signs ranks against a whole universe or none", () => {
  // The sweep walked all 999 targets but most per-repo calls failed. The old
  // rule (`done >= 30`) published it, and every panel read "#N of 30" as
  // "#N of the top 1000".
  it("refuses a finished sweep that measured 30 of 999", () => {
    expect(acceptDistribution(30, { complete: true, targets: 999 }).ok).toBe(false);
  });

  it("refuses a finished sweep that shrank sharply against the last published one", () => {
    // 850 is most of a 900-repo target list, but the last published universe had 999
    expect(acceptDistribution(850, { complete: true, targets: 900 }).ok).toBe(true);
    expect(acceptDistribution(850, { complete: true, targets: 900, prev: 999 }).ok).toBe(false);
  });

  it("never publishes a sweep that is still running, however much it measured", () => {
    expect(acceptDistribution(600, { complete: false, targets: 999 }).ok).toBe(false);
  });

  it("publishes a whole sweep", () => {
    expect(acceptDistribution(994, { complete: true, targets: 999, prev: 997 })).toEqual({ ok: true, reason: null });
  });
});
