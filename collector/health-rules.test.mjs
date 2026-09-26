import { describe, expect, it } from "vitest";
import { cancelledVerdict, cronLag, openPartials, presenceEval, presenceLost, presenceMap, prflowFreshness } from "./health-rules.mjs";

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
