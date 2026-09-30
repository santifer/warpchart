import { describe, expect, it } from "vitest";
import { cancelledVerdict, cronLag, etaIncoherences, maxAgeFromEnv, openPartials, presenceEval, presenceLost, presenceMap, prflowFreshness, watchdogStale } from "./health-rules.mjs";

describe("prflowFreshness", () => {
  // 26-sep: the first run after 00:00Z was cancelled and 25-sep never closed.
  it("fires when yesterday is still missing after 10:00Z", () => {
    const r = prflowFreshness("2026-09-24", Date.parse("2026-09-26T10:30:00Z"));
    expect(r).toMatchObject({ ok: false, expected: "2026-09-25", severity: "critical" });
  });

  it("stays quiet in the morning, while the day may still be closing", () => {
    expect(prflowFreshness("2026-09-24", Date.parse("2026-09-26T06:49:00Z")).ok).toBe(true);
  });

  it("passes once yesterday is in", () => {
    expect(prflowFreshness("2026-09-25", Date.parse("2026-09-26T18:00:00Z")).ok).toBe(true);
  });

  it("fires even in the morning when two days are missing", () => {
    expect(prflowFreshness("2026-09-23", Date.parse("2026-09-26T06:00:00Z")).ok).toBe(false);
  });
});

describe("presence transitions", () => {
  const withNpm = { usage: { npm: { last30: 9225, series: { points: [{ day: "2026-09-23", d: 350 }] } } } };
  // 2026-08-31 → 2026-09-24: the npm channel vanished after the org transfer and
  // nothing noticed for three weeks.
  const withoutNpm = { usage: { npm: null } };
  const fields = ["usage.npm", "usage.npm.series.points"];

  it("flags a field that was there and is gone", () => {
    const prev = presenceMap(withNpm, fields);
    const now = presenceMap(withoutNpm, fields);
    expect(presenceLost(prev, now)).toEqual(["usage.npm", "usage.npm.series.points"]);
  });

  it("treats an empty list as gone", () => {
    const emptied = { usage: { npm: { last30: 0, series: { points: [] } } } };
    expect(presenceLost(presenceMap(withNpm, fields), presenceMap(emptied, fields))).toEqual(["usage.npm.series.points"]);
  });

  it("treats a first sighting as a baseline, not a change", () => {
    expect(presenceLost(null, presenceMap(withoutNpm, fields))).toEqual([]);
    expect(presenceLost({}, presenceMap(withoutNpm, fields))).toEqual([]);
  });
});

describe("presenceEval: remembers until the field is back", () => {
  const npm = (here) => ({ "usage.npm": here });
  // Review catch: a first version fired ONCE and went green on the next run with
  // npm still gone (the three-week case would have closed its own issue).
  it("keeps firing while the field stays missing: warn, then critical", () => {
    let { state } = presenceEval(null, npm(true), "2026-09-01T00:00:00Z");
    let r = presenceEval(state, npm(false), "2026-09-01T06:00:00Z");
    expect(r.findings).toEqual([{ field: "usage.npm", missingSince: "2026-09-01T06:00:00Z", severity: "warn" }]);
    r = presenceEval(r.state, npm(false), "2026-09-01T12:00:00Z");
    expect(r.findings[0]).toMatchObject({ severity: "critical", missingSince: "2026-09-01T06:00:00Z" });
    r = presenceEval(r.state, npm(false), "2026-09-21T12:00:00Z");
    expect(r.findings[0].severity).toBe("critical"); // three weeks later, still red
  });

  it("clears when the field comes back", () => {
    let r = presenceEval({ "usage.npm": { seen: true, missingSince: "2026-09-01T06:00:00Z" } }, npm(true));
    expect(r.findings).toEqual([]);
    expect(r.state["usage.npm"]).toEqual({ seen: true, missingSince: null });
  });

  it("never alarms on a field that was never seen", () => {
    expect(presenceEval(null, npm(false)).findings).toEqual([]);
  });
});

describe("cronLag", () => {
  const H = 3_600_000;
  const start = Date.parse("2026-09-20T00:00:00Z");
  const every = (h, n) => Array.from({ length: n }, (_, i) => new Date(start + i * h * H).toISOString());
  const lastOf = (runs) => Date.parse(runs.at(-1));

  it("is quiet at the measured normal (~6 h)", () => {
    const runs = every(6, 20);
    expect(cronLag(runs, lastOf(runs) + 2 * H).severity).toBeNull();
  });

  it("warns when the median cadence degrades past 8 h", () => {
    const runs = every(9, 20);
    expect(cronLag(runs, lastOf(runs) + 2 * H).severity).toBe("warn");
  });

  // Review catch: completed gaps alone cannot see a cron that stopped.
  it("is critical when the cron has been silent for more than 12 h", () => {
    const runs = every(6, 20);
    expect(cronLag(runs, lastOf(runs) + 30 * H).severity).toBe("critical");
  });

  // Review catch: an old hole must not keep the alarm red for days.
  it("forgets an old 13 h hole once the recent cadence is normal", () => {
    const runs = [...every(6, 4), ...every(6, 14).map((t) => new Date(Date.parse(t) + 31 * H).toISOString())];
    expect(cronLag(runs, lastOf(runs) + 2 * H).severity).toBeNull();
  });
});

describe("openPartials", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  it("warns on a fresh refusal and goes critical after a day without recovery", () => {
    const fresh = { family: "route-history", resolved: false, since: "2026-09-26T05:00:00Z", at: "2026-09-26T05:00:00Z" };
    const old = { family: "catalog", resolved: false, since: "2026-09-25T05:00:00Z", at: "2026-09-25T05:00:00Z" };
    expect(openPartials([fresh], now).severity).toBe("warn");
    expect(openPartials([fresh, old], now).severity).toBe("critical");
  });

  // Review catch: rewriting the date on every refusal kept a 3-day problem at "warn".
  it("ages from the first refusal, not the latest one", () => {
    const repeated = { family: "catalog", resolved: false, since: "2026-09-23T05:00:00Z", at: "2026-09-26T11:00:00Z", attempts: 12 };
    expect(openPartials([repeated], now).severity).toBe("critical");
  });

  it("ignores resolved markers", () => {
    expect(openPartials([{ family: "x", resolved: true, at: "2026-09-20T00:00:00Z" }], now).severity).toBeNull();
  });
});

describe("cancelledVerdict", () => {
  const runs = (cancelledAt) => Array.from({ length: 24 }, (_, i) => ({ conclusion: cancelledAt.includes(i) ? "cancelled" : "success" }));
  it("is critical while a cancellation is recent", () => {
    expect(cancelledVerdict(runs([2, 12])).severity).toBe("critical");
  });
  it("drops to warn once the recent runs are clean (the fix held)", () => {
    expect(cancelledVerdict(runs([10, 15])).severity).toBe("warn");
  });
  it("says nothing about a single cancellation", () => {
    expect(cancelledVerdict(runs([1])).severity).toBeNull();
  });
});

describe("etaIncoherences", () => {
  // Real payload, /api/v1/overtakes 29-sep: a 12-star gap closing at 1,736/day
  // is 0.0069 d away; collisions.mjs publishes etaDays rounded to 0.01, so the
  // API says 0.01. The old 15% relative test read the rounding as a broken
  // projection and kept issue #46 critical ("says 0.01d, the numbers give 0.01d").
  const imminent = {
    hunter: { repo: "paperclipai/paperclip", velocityPerDay: 1769 },
    victim: { repo: "3b1b/manim", velocityPerDay: 33 },
    gap: 12,
    etaDays: 0.01,
  };

  it("does not read the 0.01 d publishing resolution as incoherence", () => {
    expect(etaIncoherences([imminent])).toEqual([]);
  });

  it("still fires when the ETA comes from another velocity", () => {
    const wrong = { hunter: { repo: "a/a", velocityPerDay: 60 }, victim: { repo: "b/b", velocityPerDay: 20 }, gap: 100, etaDays: 5 };
    expect(etaIncoherences([wrong])).toHaveLength(1);
  });

  it("still fires on an imminent ETA that is really off", () => {
    expect(etaIncoherences([{ ...imminent, etaDays: 0.5 }])).toHaveLength(1);
  });

  it("fires on a crossing published for a hunter shown slower than its victim", () => {
    const r = etaIncoherences([{ ...imminent, victim: { repo: "x/x", velocityPerDay: 1800 } }]);
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe("hunter shown slower than victim");
  });

  // The high side of the interval, gap/(c-1): true 31.51 and 23.49 are shown as
  // 32 and 23, so the true closing (8.02) is ABOVE the shown c=9 minus one. Drop
  // the (c-1) bound for gap/c and these legitimate ETAs turn into false alarms.
  it("accepts ETAs on the high side of the rounding interval", () => {
    const high1 = { hunter: { repo: "h/h", velocityPerDay: 32 }, victim: { repo: "v/v", velocityPerDay: 23 }, gap: 8, etaDays: 1 };
    const high2 = { hunter: { repo: "h/h", velocityPerDay: 33 }, victim: { repo: "v/v", velocityPerDay: 24 }, gap: 50, etaDays: 6.24 };
    expect(etaIncoherences([high1, high2])).toEqual([]);
  });

  // Property: anything collisions.mjs can publish passes. Same filters and the
  // same rounding as runCollisionScan (hunter >= 25/day, closing >= max(8, 15%),
  // gap >= 3, ETA <= 7 d; v shown whole, etaDays to 0.01). Seeded, deterministic.
  it("never flags what collisions.mjs can legitimately publish (20,000 generated pairs)", () => {
    let seed = 20260930;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const legit = [];
    while (legit.length < 20000) {
      const hv = Math.round(25 * Math.pow(3000 / 25, rnd()) * 10) / 10; // v7 comes at 0.1
      const closing = Math.max(8, hv * 0.15) + rnd() * hv;
      const vv = Math.round((hv - closing) * 10) / 10;
      const realClosing = hv - vv;
      if (realClosing < Math.max(8, hv * 0.15)) continue;
      const gap = 3 + Math.floor(rnd() * hv * 7);
      const eta = gap / realClosing;
      if (eta > 7) continue;
      legit.push({ hunter: { repo: "h/h", velocityPerDay: Math.round(hv) }, victim: { repo: "v/v", velocityPerDay: Math.round(vv) }, gap, etaDays: Math.round(eta * 100) / 100 });
    }
    expect(etaIncoherences(legit)).toEqual([]);
  });

  // The worst legitimate case collisions.mjs can publish: closing just above its
  // floor of 8/day, both velocities rounded the unlucky way (true 32.49 and 23.52
  // shown as 32 and 24). Rounding alone moves the ETA 12.4%; it is still right.
  it("accepts the worst legitimate rounding (closing 8, 12.4% off in relative terms)", () => {
    const edge = { hunter: { repo: "h/h", velocityPerDay: 32 }, victim: { repo: "v/v", velocityPerDay: 24 }, gap: 8, etaDays: 0.89 };
    expect(etaIncoherences([edge])).toEqual([]);
  });

  // Review of 30-sep: a relative 15% hides a projection from a velocity 10% off
  // on a fast repo, because rounding there is only ±0.06%.
  it("fires on a fast repo projected from a velocity 10% off", () => {
    const fast = { ...imminent, gap: 5000, etaDays: 3.2 }; // true ETA 5000/1736 = 2.88
    expect(etaIncoherences([fast])).toHaveLength(1);
  });

  it("fires on a published 0 for a crossing weeks away", () => {
    const zero = { hunter: { repo: "h/h", velocityPerDay: 30 }, victim: { repo: "v/v", velocityPerDay: 20 }, gap: 500, etaDays: 0 };
    expect(etaIncoherences([zero])).toHaveLength(1);
  });

  it("accepts a published 0 for a crossing minutes away", () => {
    const now = { ...imminent, gap: 3, hunter: { repo: "h/h", velocityPerDay: 1714 }, etaDays: 0 }; // 3/1700 = 0.0018 d
    expect(etaIncoherences([now])).toEqual([]);
  });

  it("reads a missing number as a failure, not as coherence", () => {
    const { gap, ...noGap } = imminent;
    const r = etaIncoherences([noGap]);
    expect(gap).toBe(12);
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe("non-numeric input");
  });
});

describe("watchdogStale", () => {
  // The health cron is declared every 2 h but GitHub runs it every 4.7 h median,
  // 7.9 h p99, 8.6 h max (149 gaps, 30 days to 30-sep). A 6 h limit went red on
  // 38 of them, including 28-sep 20:33Z at 6.1 h, with nothing broken.
  it("reads a late cron as late, not stopped (6.1 h, 28-sep 20:33Z)", () => {
    expect(watchdogStale(6.1)).toBe(false);
  });

  it("tolerates the longest real gap in 30 days (8.6 h)", () => {
    expect(watchdogStale(8.6)).toBe(false);
  });

  it("fires on a stopped schedule", () => {
    expect(watchdogStale(12.5)).toBe(true);
  });

  it("does not fire at exactly the limit", () => {
    expect(watchdogStale(12)).toBe(false);
  });

  it("reads a report without a timestamp as stale", () => {
    expect(watchdogStale(NaN)).toBe(true);
  });

  it("reads a non-numeric limit as stale rather than alive", () => {
    expect(watchdogStale(5, NaN)).toBe(true);
  });
});

describe("maxAgeFromEnv", () => {
  it("keeps the default when the override is absent, empty, not a number, zero or negative", () => {
    for (const raw of [undefined, "", "  ", "abc", "0", "-1"]) expect(maxAgeFromEnv(raw)).toBe(12);
  });

  it("honours a positive numeric override", () => {
    expect(maxAgeFromEnv("8")).toBe(8);
  });
});
