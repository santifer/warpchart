import { describe, expect, it } from "vitest";
import { COLLECTOR_STALE_H as APP_STALE_H } from "../src/lib/staleness.ts";
import { ARTIFACTS, COLLECTOR_STALE_H, npmLagExplains, cancelledVerdict, cronLag, etaIncoherences, maxAgeFromEnv, newestRunMs, pickFreshestRuns, pipelineRunsGate, RUNS_LIST_TOL_H, runsListStale, openPartials, presenceEval, presenceLost, presenceMap, prflowFreshness, npmUsageFreshness, contributorsDrift, contributorCurve, buildersWallFreshness, buildersLangMismatch, velocityRankFreshness, velocityRankReconstructed, ladderBandsPresence, gapsAfter, ciBandViolations, curveEndsOnTotal, staleArtifacts, watchdogStale, v7StampLags, v7WindowFreshness } from "./health-rules.mjs";

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

describe("inventory cadence (ARTIFACTS)", () => {
  it("mirrors the app's single collector threshold (src/lib/staleness.ts)", () => {
    expect(COLLECTOR_STALE_H).toBe(APP_STALE_H);
  });

  // The 6 h declarations for the tenant families contradicted the 10 h the app
  // already used for the same collector: a family cannot be expected fresher
  // than the collector that writes it can deliver.
  it("no periodic family expects fresher than the collector can deliver", () => {
    const tooTight = ARTIFACTS.filter((a) => a.kind === "periodic" && !(Number.isFinite(a.maxAgeH) && a.maxAgeH >= COLLECTOR_STALE_H)).map((a) => `${a.prefix}=${a.maxAgeH}`);
    expect(tooTight).toEqual([]);
  });

  // Reconstructed from the real 19:01Z report of 30-sep: the tenant families were
  // last uploaded at 12:27:41Z (Blob uploadedAt; collector run created 12:26:46Z)
  // and GitHub had not granted the next run yet, so they were ~6.6 h old.
  const now = Date.parse("2026-09-30T19:01:33Z");
  const newest = new Map(ARTIFACTS.filter((a) => a.kind === "periodic").map((a) => [a.prefix, now - 3_600_000]));
  for (const p of ["data/history.jsonl", "data/stargazer_timestamps.txt", "data/meta.json"]) newest.set(p, Date.parse("2026-09-30T12:27:41Z"));

  it("reads a late cron as late, not as a family that stopped (30-sep 19:01Z)", () => {
    expect(staleArtifacts(newest, now).stale).toEqual([]);
  });

  it("still names families that really stopped", () => {
    const later = Date.parse("2026-09-30T23:30:00Z"); // 11 h after the last run
    expect(staleArtifacts(newest, later).stale.map((s) => s.prefix).sort()).toEqual(["data/history.jsonl", "data/meta.json", "data/stargazer_timestamps.txt"]);
  });

  it("reads an unparseable upload time as stale, not fresh", () => {
    const bad = new Map(newest);
    bad.set("data/meta.json", NaN);
    expect(staleArtifacts(bad, now).stale.map((s) => s.prefix)).toEqual(["data/meta.json"]);
  });
});

// Real Actions API pages of collect.yml. STALE_PAGE ends on 6-sep 23:50Z (the
// page one token of the pool kept receiving on 30-sep); FRESH_PAGE is what the
// same call returned at 19:11Z on 30-sep.
const STALE_PAGE = [
    { created_at: "2026-09-06T23:50:47Z", run_started_at: "2026-09-06T23:50:47Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-06T22:05:21Z", run_started_at: "2026-09-06T22:05:21Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-06T18:13:50Z", run_started_at: "2026-09-06T18:13:50Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-06T15:23:29Z", run_started_at: "2026-09-06T15:23:29Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-06T10:49:23Z", run_started_at: "2026-09-06T10:49:23Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-06T04:28:55Z", run_started_at: "2026-09-06T04:28:55Z", event: "schedule", conclusion: "cancelled" },
    { created_at: "2026-09-05T23:49:36Z", run_started_at: "2026-09-05T23:49:36Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-05T22:01:54Z", run_started_at: "2026-09-05T22:01:54Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-05T18:12:14Z", run_started_at: "2026-09-05T18:12:14Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-05T15:06:30Z", run_started_at: "2026-09-05T15:06:30Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-05T10:29:05Z", run_started_at: "2026-09-05T10:29:05Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-05T04:18:01Z", run_started_at: "2026-09-05T04:18:01Z", event: "schedule", conclusion: "cancelled" },
    { created_at: "2026-09-04T23:58:45Z", run_started_at: "2026-09-04T23:58:45Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-04T20:42:22Z", run_started_at: "2026-09-04T20:42:22Z", event: "schedule", conclusion: "cancelled" },
    { created_at: "2026-09-04T16:16:31Z", run_started_at: "2026-09-04T16:16:31Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-04T11:10:24Z", run_started_at: "2026-09-04T11:10:24Z", event: "schedule", conclusion: "failure" },
    { created_at: "2026-09-04T04:22:37Z", run_started_at: "2026-09-04T04:22:37Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-04T00:00:08Z", run_started_at: "2026-09-04T00:00:08Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-03T20:56:45Z", run_started_at: "2026-09-03T20:56:45Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-03T17:48:35Z", run_started_at: "2026-09-03T17:48:35Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-03T12:46:53Z", run_started_at: "2026-09-03T12:46:53Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-03T07:07:25Z", run_started_at: "2026-09-03T07:07:25Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-03T05:10:38Z", run_started_at: "2026-09-03T05:10:38Z", event: "workflow_dispatch", conclusion: "success" },
    { created_at: "2026-09-03T00:08:12Z", run_started_at: "2026-09-03T00:08:12Z", event: "schedule", conclusion: "success" },
  ];
const FRESH_PAGE = [
    { created_at: "2026-09-30T19:11:11Z", run_started_at: "2026-09-30T19:11:11Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-30T12:26:46Z", run_started_at: "2026-09-30T12:26:46Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-30T05:24:58Z", run_started_at: "2026-09-30T05:24:58Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-29T22:10:16Z", run_started_at: "2026-09-29T22:10:16Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-29T16:28:17Z", run_started_at: "2026-09-29T16:28:17Z", event: "schedule", conclusion: "failure" },
    { created_at: "2026-09-29T08:22:05Z", run_started_at: "2026-09-29T08:22:05Z", event: "schedule", conclusion: "failure" },
    { created_at: "2026-09-29T01:51:07Z", run_started_at: "2026-09-29T01:51:07Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-28T20:30:50Z", run_started_at: "2026-09-28T20:30:50Z", event: "schedule", conclusion: "failure" },
    { created_at: "2026-09-28T13:44:40Z", run_started_at: "2026-09-28T13:44:40Z", event: "schedule", conclusion: "failure" },
    { created_at: "2026-09-28T05:14:56Z", run_started_at: "2026-09-28T05:14:56Z", event: "schedule", conclusion: "failure" },
    { created_at: "2026-09-27T22:58:34Z", run_started_at: "2026-09-27T22:58:34Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-27T18:18:05Z", run_started_at: "2026-09-27T18:18:05Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-27T13:52:52Z", run_started_at: "2026-09-27T13:52:52Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-27T09:31:03Z", run_started_at: "2026-09-27T09:31:03Z", event: "workflow_dispatch", conclusion: "success" },
    { created_at: "2026-09-27T08:02:33Z", run_started_at: "2026-09-27T08:02:33Z", event: "schedule", conclusion: "failure" },
    { created_at: "2026-09-27T00:30:04Z", run_started_at: "2026-09-27T00:30:04Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-26T21:03:29Z", run_started_at: "2026-09-26T21:03:29Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-26T16:17:32Z", run_started_at: "2026-09-26T16:17:32Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-26T11:16:44Z", run_started_at: "2026-09-26T11:16:44Z", event: "schedule", conclusion: "success" },
    { created_at: "2026-09-26T10:22:20Z", run_started_at: "2026-09-26T10:22:20Z", event: "workflow_dispatch", conclusion: "success" },
    { created_at: "2026-09-26T09:58:53Z", run_started_at: "2026-09-26T09:58:53Z", event: "workflow_dispatch", conclusion: "success" },
    { created_at: "2026-09-26T06:59:13Z", run_started_at: "2026-09-26T06:59:13Z", event: "workflow_dispatch", conclusion: "success" },
    { created_at: "2026-09-26T06:52:16Z", run_started_at: "2026-09-26T06:52:16Z", event: "workflow_dispatch", conclusion: "failure" },
    { created_at: "2026-09-26T04:49:28Z", run_started_at: "2026-09-26T04:49:28Z", event: "schedule", conclusion: "cancelled" },
  ];


describe("stale runs list (pipeline.*)", () => {
  it("the stale page alone reads as a dead cron: the 30-sep false critical", () => {
    const lag = cronLag(STALE_PAGE.filter((r) => r.event === "schedule").map((r) => r.run_started_at), Date.parse("2026-09-30T16:30:34Z"));
    expect(lag.sinceLastH).toBeCloseTo(568.7, 1);
    expect(lag.severity).toBe("critical");
    expect(STALE_PAGE.filter((r) => r.conclusion === "cancelled")).toHaveLength(3);
  });

  it("keeps the freshest list whatever order the pool answers in", () => {
    const stale = { ok: true, body: { workflow_runs: STALE_PAGE } };
    const fresh = { ok: true, body: { workflow_runs: FRESH_PAGE } };
    expect(pickFreshestRuns([stale, fresh])).toMatchObject({ token: 1, list: FRESH_PAGE });
    expect(pickFreshestRuns([fresh, stale])).toMatchObject({ token: 0, list: FRESH_PAGE });
    // what the old first-200 rule used
    expect([stale, fresh].find((r) => r.ok).body.workflow_runs).toBe(STALE_PAGE);
  });

  it("ignores a token that failed and says so", () => {
    const r = pickFreshestRuns([{ ok: false, body: null }, { ok: true, body: { workflow_runs: FRESH_PAGE } }]);
    expect(r.token).toBe(1);
    expect(r.perToken[0]).toMatchObject({ token: 0, ok: false, runs: null, newest: null });
  });

  it("refuses to judge a list that is behind the collector's own snapshot", () => {
    const lastSnapshot = Date.parse("2026-09-30T19:11:57Z");
    expect(runsListStale(newestRunMs(STALE_PAGE), lastSnapshot)).toBe(true);
    expect(runsListStale(newestRunMs(FRESH_PAGE), lastSnapshot)).toBe(false);
  });

  it("does not guess without an independent timestamp", () => {
    expect(runsListStale(newestRunMs(STALE_PAGE), NaN)).toBe(false);
  });

  it("an empty or unreadable list is stale against a known snapshot", () => {
    expect(runsListStale(newestRunMs([]), Date.parse("2026-09-30T19:11:57Z"))).toBe(true);
  });

  it("tolerates a normal gap plus a run in progress, not more (boundaries)", () => {
    const snap = Date.parse("2026-09-30T19:00:00Z");
    const behind = (h) => snap - h * 3_600_000;
    expect(runsListStale(behind(8.5), snap)).toBe(false);
    expect(runsListStale(behind(10.5), snap)).toBe(false);
    expect(runsListStale(behind(11.5), snap)).toBe(true);
    expect(runsListStale(behind(RUNS_LIST_TOL_H), snap)).toBe(false);
    expect(runsListStale(behind(RUNS_LIST_TOL_H + 0.01), snap)).toBe(true);
  });
});

describe("pipelineRunsGate", () => {
  const ok = (runs) => ({ ok: true, body: { workflow_runs: runs } });
  const failed = { ok: false, body: null };
  const snap = Date.parse("2026-09-30T19:11:57Z");

  it("real 30-sep case: judges the fresh list and names the token that saw the stale one", () => {
    const g = pipelineRunsGate([ok(STALE_PAGE), ok(FRESH_PAGE), ok(FRESH_PAGE)], snap);
    expect(g.gate).toBe("ok");
    expect(g.list).toBe(FRESH_PAGE);
    expect(g.lagging.map((t) => t.token)).toEqual([0]);
  });

  it("refuses to judge when every token only has the stale list", () => {
    expect(pipelineRunsGate([ok(STALE_PAGE)], snap).gate).toBe("stale");
  });

  // The rule that must never break: a collector that really stopped has a
  // snapshot as old as its newest run, so its list is not "stale" and cron-lag
  // still fires as critical.
  it("a cron that really died is still judged, and still critical", () => {
    const deadSnap = Date.parse("2026-09-06T23:51:40Z");
    const g = pipelineRunsGate([ok(STALE_PAGE)], deadSnap);
    expect(g.gate).toBe("ok");
    const lag = cronLag(g.list.filter((r) => r.event === "schedule").map((r) => r.run_started_at), Date.parse("2026-09-30T16:30:34Z"));
    expect(lag.severity).toBe("critical");
  });

  it("a failed or timed-out token does not decide anything", () => {
    const g = pipelineRunsGate([failed, ok(FRESH_PAGE)], snap);
    expect(g).toMatchObject({ gate: "ok", token: 1 });
    expect(g.lagging).toEqual([]);
  });

  it("no readable token is 'unreadable', never a pass", () => {
    expect(pipelineRunsGate([failed, failed], snap).gate).toBe("unreadable");
    expect(pipelineRunsGate([{ ok: true, body: { message: "Not Found" } }], snap).gate).toBe("unreadable");
    expect(pipelineRunsGate([], snap).gate).toBe("unreadable");
  });

  it("names a token that read an empty list while another had runs", () => {
    expect(pipelineRunsGate([ok([]), ok(FRESH_PAGE)], snap).lagging.map((t) => t.token)).toEqual([0]);
  });

  it("without the snapshot, still names a token that trails the freshest list", () => {
    expect(pipelineRunsGate([ok(STALE_PAGE), ok(FRESH_PAGE)], NaN).lagging.map((t) => t.token)).toEqual([0]);
  });

  it("an empty list next to a known snapshot is a contradiction, not 'no runs'", () => {
    expect(pipelineRunsGate([ok([])], snap).gate).toBe("empty");
    expect(pipelineRunsGate([ok([])], NaN).gate).toBe("none");
  });

  it("without the snapshot it judges the freshest list rather than guessing", () => {
    expect(pipelineRunsGate([ok(STALE_PAGE), ok(FRESH_PAGE)], NaN)).toMatchObject({ gate: "ok", token: 1 });
  });

  it("undated runs do not crash it", () => {
    const g = pipelineRunsGate([ok([{ event: "schedule", conclusion: "success" }])], snap);
    expect(g.gate).toBe("stale");
    expect(g.newestIso).toBeNull();
  });
});

describe("npmUsageFreshness", () => {
  it("accepts a recorded week while it is recent, and says when the total is a floor", () => {
    const r = npmUsageFreshness({ versions: { through: "2026-10-04" }, last30IsLowerBound: true, last30MissingDays: 4, last30Estimate: 9905, latest: "1.35.0" }, "2026-10-09");
    expect(r.severity).toBeNull();
    expect(r.note).toMatch(/4 of 30 days missing/);
  });
  it("warns when days are missing but the estimate is not published", () => {
    const r = npmUsageFreshness({ versions: { through: "2026-10-04" }, last30MissingDays: 4, last30Estimate: null }, "2026-10-09");
    expect(r.severity).toBe("warn");
  });
  it("warns when the breakdown has not moved for more than ten days", () => {
    expect(npmUsageFreshness({ versions: { through: "2026-09-25" } }, "2026-10-09").severity).toBe("warn");
  });
});

describe("contributorsDrift", () => {
  it("flags the REST cap that published 463 while GitHub showed 611", () => {
    expect(contributorsDrift(463, 611).severity).toBe("warn");
  });
  it("tolerates the hours between two daily readings", () => {
    expect(contributorsDrift(606, 611).severity).toBeNull();
  });
  it("flags a missing count and skips an unreadable sidebar", () => {
    expect(contributorsDrift(null, 611).severity).toBe("warn");
    expect(contributorsDrift(611, null).severity).toBeNull();
  });
});

describe("contributorCurve", () => {
  const row = (d, c) => ({ day: d, cumulative: c });
  // the API's real shape: every series goes through windowed() (review, 2026-10-11)
  const win = (...points) => ({ from: points[0]?.day ?? null, to: points.at(-1)?.day ?? null, days: points.length, points });
  it("passes when the curve ends on the figure the panel prints", () => {
    expect(contributorCurve({ total: 614, series: { github: win(row("2026-04-04", 1), row("2026-10-11", 614)) } }).severity).toBeNull();
  });
  it("warns when the curve and the number disagree", () => {
    expect(contributorCurve({ total: 614, series: { github: win(row("2026-10-11", 616)) } }).severity).toBe("warn");
  });
  it("warns when the chart fell back to the census toggle", () => {
    // the dossier of 2026-10-11 before this change: no github series at all
    expect(contributorCurve({ total: 611, series: { github: null, authors: win(row("2026-10-11", 480)), credited: win() } }).severity).toBe("critical");
  });
  it("stays quiet without a live figure (presence.contributors owns that)", () => {
    expect(contributorCurve({ total: null, series: null }).severity).toBeNull();
  });
});

describe("npmUsageFreshness: npm latest", () => {
  const versions = { start: "2026-09-28", through: "2026-10-04", list: [{ version: "1.35.0", d: 1030 }] };
  it("warns when the versions week ships without npm's latest tag", () => {
    // the dossier of 2026-10-12 had no `latest` at all
    expect(npmUsageFreshness({ versions }, "2026-10-12").severity).toBe("warn");
  });
  it("passes with the latest tag alongside", () => {
    expect(npmUsageFreshness({ versions, latest: "1.36.0" }, "2026-10-12").severity).toBeNull();
  });
});

describe("curveEndsOnTotal", () => {
  it("warns on the gross curve of 2026-10-14", () => {
    // /api/curve?repo=career-ops-hq/career-ops: last point 75,922, total 74,432
    expect(curveEndsOnTotal({ total: 74432, pts: [{ t: 1, v: 1 }, { t: 2, v: 75922 }] }).severity).toBe("warn");
  });
  it("passes when the curve ends on the net count", () => {
    expect(curveEndsOnTotal({ total: 74432, pts: [{ t: 1, v: 1 }, { t: 2, v: 74432 }] }).severity).toBeNull();
  });
});

// route.json as served on 2026-10-16 ~11Z: the registry refreshed the day before
// at 11:20Z and the v7 closed there, though the 16th was already recorded.
describe("fresh.v7-window: the age of the house repo's 7-day rate", () => {
  const NOW = Date.parse("2026-10-16T11:00:00Z");
  const served = {
    generated_at: "2026-10-15T11:20:12Z",
    v7_at: "2026-10-15T11:20:12Z",
    repos: [{ r: "career-ops-hq/career-ops", s: 74799, v: 333.1, v7: 151.6 }],
  };

  it("fails when the rate cannot be dated (the payload served on 2026-10-16)", () => {
    expect(v7WindowFreshness(served, "career-ops-hq/career-ops", NOW)).toMatchObject({ ok: false, reason: "absent" });
  });

  it("fails when the window closed more than 26 h ago", () => {
    const old = { ...served, repos: [{ ...served.repos[0], v7_to: "2026-10-15T08:00:00.000Z" }] };
    expect(v7WindowFreshness(old, "career-ops-hq/career-ops", NOW)).toMatchObject({ ok: false, reason: "stale" });
  });

  it("stays quiet on a normal day (closed on the 00:25Z capture)", () => {
    const ok = { ...served, repos: [{ ...served.repos[0], v7_to: "2026-10-16T00:25:00.000Z" }] };
    const r = v7WindowFreshness(ok, "career-ops-hq/career-ops", NOW);
    expect(r.ok).toBe(true);
    expect(r.ageH).toBeCloseTo(10.58, 1);
  });

  it("fails when the house repo is missing from the registry", () => {
    expect(v7WindowFreshness({ repos: [] }, "career-ops-hq/career-ops", NOW)).toMatchObject({ ok: false, reason: "missing" });
  });

  it("fresh.v7 accepts a stamp NEWER than the registry (a recorded day) and flags an older one", () => {
    expect(v7StampLags({ generated_at: "2026-10-15T11:20:12Z", v7_at: "2026-10-16T00:24:58.644Z" })).toBe(false);
    expect(v7StampLags({ generated_at: "2026-10-15T11:20:12Z", v7_at: "2026-10-15T11:20:12Z" })).toBe(false);
    expect(v7StampLags({ generated_at: "2026-10-16T11:20:12Z", v7_at: "2026-10-15T11:20:12Z" })).toBe(true);
    expect(v7StampLags({ generated_at: "2026-10-16T11:20:12Z" })).toBe(true);
  });
});

describe("buildersWallFreshness", () => {
  const now = Date.parse("2026-10-17T18:00:00Z");
  it("missing wall is a warning, not silence", () => {
    expect(buildersWallFreshness(null, now).severity).toBe("warn");
  });
  it("a wall older than 30 h warns (it prints 'joined this week')", () => {
    expect(buildersWallFreshness({ generatedAt: "2026-10-16T08:00:00Z", langs: ["en"], people: 667, week: 34 }, now).severity).toBe("warn");
  });
  it("a fresh wall with English passes", () => {
    expect(buildersWallFreshness({ generatedAt: "2026-10-17T12:00:00Z", langs: ["en", "es"], people: 667, week: 34 }, now).severity).toBeNull();
  });
  it("a wall without the English fallback warns", () => {
    expect(buildersWallFreshness({ generatedAt: "2026-10-17T12:00:00Z", langs: ["es"], people: 667, week: 34 }, now).severity).toBe("warn");
  });
});

describe("buildersWallFreshness: size", () => {
  it("warns past 1.8 MB (Next's data cache skips entries over 2 MB without a word)", () => {
    const now = Date.parse("2026-10-17T18:00:00Z");
    expect(buildersWallFreshness({ generatedAt: "2026-10-17T12:00:00Z", langs: ["en"], people: 1600, week: 40, bytes: 1.9 * 1048576 }, now).severity).toBe("warn");
  });
});

describe("buildersLangMismatch", () => {
  it("flags a language served as the English fallback (es/pt-BR on 17-oct)", () => {
    const r = buildersLangMismatch(["en", "es", "pt-BR", "ja"], { en: "en", es: "en", "pt-BR": "en", ja: "ja" });
    expect(r.severity).toBe("warn");
    expect(r.note).toContain("es→en");
  });
  it("passes when every language answers in itself", () => {
    expect(buildersLangMismatch(["en", "ja"], { en: "en", ja: "ja" }).severity).toBeNull();
  });
});

describe("velocityRankFreshness", () => {
  const meta = { days: 108, first: "2026-06-14", last: "2026-10-19", lastTo: "2026-10-20" };
  const now = Date.parse("2026-10-20T09:00:00Z");
  it("passes when the table reaches the newest recorded day", () => {
    expect(velocityRankFreshness(meta, "2026-10-20", "2026-10-20T04:42:17Z", now).severity).toBeNull();
  });
  it("gives the run that recorded the day time to build it", () => {
    expect(velocityRankFreshness({ ...meta, lastTo: "2026-10-19" }, "2026-10-20", "2026-10-20T04:42:17Z", now).severity).toBeNull();
  });
  it("warns when the table stays behind the moat past the grace", () => {
    const r = velocityRankFreshness({ ...meta, lastTo: "2026-10-19" }, "2026-10-20", "2026-10-19T22:00:00Z", now);
    expect(r.severity).toBe("warn");
    expect(r.note).toMatch(/stops at 2026-10-19/);
  });
  it("warns when the newest day ranked a top 1,000 with holes (2026-06-29 kept 909)", () => {
    expect(velocityRankFreshness({ ...meta, lastN: 909 }, "2026-10-20", "2026-10-20T04:42:17Z", now).severity).toBe("warn");
    expect(velocityRankFreshness({ ...meta, lastN: 999 }, "2026-10-20", "2026-10-20T04:42:17Z", now).severity).toBeNull();
  });
  it("a missing table is a warning, never a pass", () => {
    expect(velocityRankFreshness(null, "2026-10-20", null, now).severity).toBe("warn");
  });
});

describe("velocityRankReconstructed", () => {
  it("warns when the hand-made reconstruction is gone or truncated, passes on the real shape", () => {
    expect(velocityRankReconstructed(null).severity).toBe("warn");
    expect(velocityRankReconstructed({ days: Array(74).fill("d"), repos: { a: {} } }).severity).toBe("warn");
    const repos = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`r/${i}`, {}]));
    expect(velocityRankReconstructed({ from: "2026-04-01", to: "2026-06-13", days: Array(74).fill("d"), repos }).severity).toBeNull();
  });
});

describe("npmLagExplains: a family stale because npm stopped publishing is not our outage", () => {
  // the health run of 2026-10-21T14:06Z: npm-versions/ 86 h old, react's
  // point/last-week ended on 2026-10-18 (npm 3 days behind for every package)
  const now = Date.parse("2026-10-21T14:06:34Z");
  const npmFam = { ...ARTIFACTS.find((a) => a.prefix === "npm-versions/"), ageH: 86 };

  it("explains the real case: npm 3 days behind and we kept up until it stalled", () => {
    expect(npmLagExplains(npmFam, "2026-10-18", now)).toEqual({ lagDays: 3, npmEnd: "2026-10-18" });
  });
  it("npm current (ends yesterday): our staleness is ours, stays critical", () => {
    expect(npmLagExplains(npmFam, "2026-10-20", now)).toBeNull();
  });
  it("the first day of a stall is covered too: 2 days behind", () => {
    expect(npmLagExplains({ ...npmFam, ageH: 40 }, "2026-10-19", now)).toEqual({ lagDays: 2, npmEnd: "2026-10-19" });
  });
  it("staleArtifacts keeps the upstream tag the rule reads (the wiring health.mjs relies on)", () => {
    const newest = new Map([["npm-versions/", now - 86 * 3600e3]]);
    const npmStale = staleArtifacts(newest, now).stale.find((x) => x.prefix === "npm-versions/");
    expect(npmStale.upstream).toBe("npm");
    expect(npmLagExplains(npmStale, "2026-10-18", now)).toEqual({ lagDays: 3, npmEnd: "2026-10-18" });
  });
  it("we stopped long before npm did: not explained", () => {
    expect(npmLagExplains({ ...npmFam, ageH: 300 }, "2026-10-18", now)).toBeNull();
  });
  it("npm unreachable or a non-npm family: never explained", () => {
    expect(npmLagExplains(npmFam, null, now)).toBeNull();
    expect(npmLagExplains({ ...ARTIFACTS.find((a) => a.prefix === "traffic/"), ageH: 86 }, "2026-10-18", now)).toBeNull();
  });
});

describe("velocityRankReconstructed: a new gap after the reconstruction", () => {
  const repos = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`r/${i}`, {}]));
  const rec = { from: "2026-04-01", to: "2026-09-30", days: Array(183).fill("d"), repos };
  // the real table around the end: complete through 22 Oct, but say 9 Oct is cut short
  const table = ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-10"];

  it("a table day missing after rec.to is a warn naming it", () => {
    const r = velocityRankReconstructed(rec, table);
    expect(r.severity).toBe("warn");
    expect(r.note).toContain("2026-10-09");
  });

  it("no gap after rec.to, or the table not read: no warn", () => {
    expect(velocityRankReconstructed(rec, [...table, "2026-10-09"]).severity).toBeNull();
    expect(velocityRankReconstructed(rec, null).severity).toBeNull();
  });

  it("gapsAfter ignores the days up to rec.to and the open end", () => {
    expect(gapsAfter(["2026-09-02", "2026-09-05"], "2026-09-02")).toEqual(["2026-09-03", "2026-09-04"]);
    expect(gapsAfter([], "2026-09-30")).toEqual([]);
  });
});

describe("ciBandViolations", () => {
  const vault = { "2026-08-25": { c: 5174 }, "2026-10-21": { c: 8391 }, "2026-10-22": { c: 100 } };
  it("21 Oct is consistent (1,361 checkouts x 1 <= 8,391 clones)", () => {
    expect(ciBandViolations({ "2026-10-21": { checkouts: 1361 } }, vault).severity).toBeNull();
  });
  it("a day counting more CI than clones is a warn naming it", () => {
    const r = ciBandViolations({ "2026-08-25": { checkouts: 6000 } }, vault);
    expect(r.severity).toBe("warn");
    expect(r.note).toContain("2026-08-25");
  });
  it("the vault's newest day is skipped: GitHub may still be closing it", () => {
    expect(ciBandViolations({ "2026-10-22": { checkouts: 900 } }, vault).severity).toBeNull();
  });
  it("days only one side has are not compared", () => {
    expect(ciBandViolations({ "2026-10-22": { checkouts: 9999 } }, { "2026-10-21": { c: 10 } }).severity).toBeNull();
  });
});

describe("ladderBandsPresence", () => {
  // what React renders on the ladder's wrapper (DailyLadder.tsx)
  const html = (n, last) => `<div class="flex w-full flex-col gap-1.5 " data-ladder-bands="${n}" data-ladder-bands-last="${last}"><div class="w-full">`;

  it("passes with zones whose newest month is this month", () => {
    expect(ladderBandsPresence(html(5, "2026-10"), "2026-10-26")).toMatchObject({ severity: null });
  });
  it("warns when the server handed over no zones", () => {
    expect(ladderBandsPresence(html(0, ""), "2026-10-26").severity).toBe("warn");
  });
  it("warns when the ladder is not on the page at all", () => {
    expect(ladderBandsPresence("<html>no ladder</html>", "2026-10-26").severity).toBe("warn");
  });
  it("lets the 1st of a month through on last month's zone (caches), not the 2nd", () => {
    expect(ladderBandsPresence(html(5, "2026-10"), "2026-11-01").severity).toBeNull();
    expect(ladderBandsPresence(html(5, "2026-10"), "2026-11-02")).toMatchObject({ severity: "warn", note: expect.stringContaining("not 2026-11") });
  });
  it("handles the year boundary", () => {
    expect(ladderBandsPresence(html(7, "2026-12"), "2027-01-01").severity).toBeNull();
  });
});
