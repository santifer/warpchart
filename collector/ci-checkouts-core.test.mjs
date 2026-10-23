import { describe, expect, it } from "vitest";
import { checkoutsOfDay, ciSplit, CI_CLONES_PER_CHECKOUT, countDay, dayIsFinal, dayOrder, dayRatio, hasCheckout, isGhost, losesHistory, mergeRecord, tallyRuns } from "./ci-checkouts-core.mjs";

// career-ops, 21 Oct 2026: run conclusions as the API lists them (a slice)
const run = (id, workflow_id, name, conclusion, hh = "10") => ({
  id, workflow_id, name, conclusion, run_attempt: 1,
  created_at: `2026-10-21T${hh}:00:00Z`, run_started_at: `2026-10-21T${hh}:00:00Z`, updated_at: `2026-10-21T${hh}:06:00Z`,
});
const day = [
  run(1, 10, "Tests", "success"),
  run(2, 10, "Tests", "failure"),
  run(3, 10, "Tests", "cancelled"),
  run(4, 20, "ledger-bot", "skipped"), // 66 of these that day: no job ran
  run(5, 30, "Depends on", "action_required"), // waits for approval: no job ran
  run(6, 40, "Welcome", "success"),
  run(7, 50, "CodeQL Analysis", "success"),
];

describe("tallyRuns", () => {
  it("counts only runs that executed jobs, per workflow, with its successes in time order", () => {
    const t = tallyRuns([run(9, 10, "Tests", "success", "23"), run(2, 10, "Tests", "failure"), ...day]);
    expect([...t.keys()].sort()).toEqual([10, 40, 50]);
    expect(t.get(10)).toEqual({ name: "Tests", n: 5, ids: [1, 9] });
  });
});

describe("isGhost", () => {
  // run 35534682838: Tests from the fork ahmets34/career-ops, waited for
  // approval, closed by GitHub 15 days later as failure with 0 jobs (real)
  const ghost = {
    id: 35534682838, workflow_id: 10, name: "Tests", conclusion: "failure", run_attempt: 1,
    created_at: "2026-09-20T20:10:26Z", run_started_at: "2026-09-20T20:10:26Z", updated_at: "2026-10-05T16:36:36Z",
  };

  it("a run closed days later without a job is a ghost, and is not counted", () => {
    expect(isGhost(ghost)).toBe(true);
    expect(tallyRuns([ghost]).size).toBe(0);
  });

  it("a real failure, a re-run, or a success is not", () => {
    expect(isGhost({ ...ghost, updated_at: "2026-09-20T20:20:00Z" })).toBe(false);
    expect(isGhost({ ...ghost, run_attempt: 2 })).toBe(false);
    expect(isGhost({ ...ghost, conclusion: "success" })).toBe(false);
  });
});

describe("dayOrder", () => {
  it("yesterday first, then the oldest missing days; counted days are skipped", () => {
    const final = ["2026-06-02", "2026-06-03", "2026-06-04", "2026-10-21", "2026-10-22"];
    expect(dayOrder(final, { "2026-06-03": {} })).toEqual(["2026-10-22", "2026-06-02", "2026-06-04", "2026-10-21"]);
    expect(dayOrder(final, Object.fromEntries(final.map((d) => [d, {}])))).toEqual([]);
  });
});

describe("hasCheckout", () => {
  it("matches the real step names and ignores skipped jobs", () => {
    expect(hasCheckout({ conclusion: "success", steps: [{ name: "Set up job" }, { name: "Run actions/checkout@v4" }] })).toBe(true);
    expect(hasCheckout({ conclusion: "success", steps: [{ name: "Check out repo" }] })).toBe(true);
    expect(hasCheckout({ conclusion: "success", steps: [{ name: "Welcome first-time contributor" }] })).toBe(false);
    expect(hasCheckout({ conclusion: "skipped", steps: [{ name: "Run actions/checkout@v4" }] })).toBe(false);
  });
});

describe("checkoutsOfDay", () => {
  // the ratios read that day from real runs: Tests 5 jobs, CodeQL 2, Welcome 0
  const ratios = { 10: 5, 40: 0, 50: 2 };
  it("sums runs x checkout jobs per run, and keeps both per workflow", () => {
    expect(checkoutsOfDay(tallyRuns(day), (id) => ratios[id])).toEqual({
      runs: 5,
      checkouts: 17,
      wf: { 10: { name: "Tests", n: 3, r: 5 }, 40: { name: "Welcome", n: 1, r: 0 }, 50: { name: "CodeQL Analysis", n: 1, r: 2 } },
    });
  });

  it("the ratio is the day's: Tests at 3 on 3 Aug and 5 on 12 Aug give different days", () => {
    const tests = [run(1, 10, "Tests", "success"), run(2, 10, "Tests", "success")];
    expect(checkoutsOfDay(tallyRuns(tests), () => 3).checkouts).toBe(6);
    expect(checkoutsOfDay(tallyRuns(tests), () => 5).checkouts).toBe(10);
  });

  it("a ratio that is not a number is unknown, not 0", () => {
    expect(checkoutsOfDay(tallyRuns(day), (id) => (id === 50 ? NaN : ratios[id]))).toBeNull();
  });

  it("a workflow with no known ratio makes the day uncountable, never 0", () => {
    expect(checkoutsOfDay(tallyRuns(day), (id) => (id === 50 ? undefined : ratios[id]))).toBeNull();
  });
});

describe("ciSplit", () => {
  it("21 Oct: 8,391 clones, 1,361 checkout jobs -> CI at least 1,361, unsure 5,444, not our CI at least 1,586", () => {
    expect(CI_CLONES_PER_CHECKOUT).toEqual({ low: 1, high: 5 });
    expect(ciSplit(8391, 1361)).toEqual({ ciMin: 1361, unsure: 5444, notCiMin: 1586 });
  });

  it("13 Oct (24,447 clones, 3,493 checkouts): even at 5 per checkout, 6,982 are NOT our CI", () => {
    expect(ciSplit(24447, 3493)).toEqual({ ciMin: 3493, unsure: 13972, notCiMin: 6982 });
  });

  it("the three parts always add up to the day's clones, and are capped by it", () => {
    for (const [c, k] of [[1000, 400], [1000, 100], [8391, 1361], [0, 50]]) {
      const s = ciSplit(c, k);
      expect(s.ciMin + s.unsure + s.notCiMin).toBe(c);
      expect(Math.min(s.ciMin, s.unsure, s.notCiMin)).toBeGreaterThanOrEqual(0);
    }
    expect(ciSplit(1000, 400)).toEqual({ ciMin: 400, unsure: 600, notCiMin: 0 });
  });

  it("an unmeasured side is null, not a zero split", () => {
    expect(ciSplit(8391, undefined)).toBeNull();
    expect(ciSplit(undefined, 1340)).toBeNull();
  });
});

describe("dayIsFinal", () => {
  it("a UTC day is final two hours after it ends", () => {
    expect(dayIsFinal("2026-10-22", Date.parse("2026-10-23T01:59:00Z"))).toBe(false);
    expect(dayIsFinal("2026-10-22", Date.parse("2026-10-23T02:00:00Z"))).toBe(true);
  });
});

describe("mergeRecord / losesHistory", () => {
  const prev = { days: { "2026-10-21": { runs: 1100, checkouts: 1340 } } };

  it("adds new days and never rewrites a counted day", () => {
    const next = mergeRecord(prev, {
      repo: "career-ops-hq/career-ops",
      at: "2026-10-23T10:00:00Z",
      days: { "2026-10-21": { runs: 1, checkouts: 1 }, "2026-10-22": { runs: 2055, checkouts: 2688 } },
    });
    expect(next.days["2026-10-21"]).toEqual({ runs: 1100, checkouts: 1340 });
    expect(next.days["2026-10-22"]).toEqual({ runs: 2055, checkouts: 2688 });
    expect(next.range).toEqual({ low: 1, high: 5 });
    expect(losesHistory(prev, next)).toBeNull();
  });

  it("a next record missing a counted day is refused", () => {
    expect(losesHistory(prev, { days: {} })).toMatch(/2026-10-21/);
  });
});

describe("dayRatio / countDay (one day, end to end, with fake API calls)", () => {
  it("first and last run agree: two reads, that figure", async () => {
    const reads = [];
    const r = await dayRatio([1, 2, 3, 4, 5], async (id) => (reads.push(id), 5));
    expect(r).toBe(5);
    expect(reads).toEqual([1, 5]);
  });

  it("4 Aug: Tests went from 4 to 5 checkout jobs mid-day: first, last and three between, averaged", async () => {
    // 10 runs; runs 1-3 before the change (4 jobs), 4-10 after (5 jobs):
    // reads 1 (4), 10 (5), 3 (4), 5 (5), 7 (5) -> 4.6
    expect(await dayRatio([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], async (id) => (id <= 3 ? 4 : 5))).toBe(4.6);
  });

  it("with 5 runs or fewer, every run is read once", async () => {
    const reads = [];
    expect(await dayRatio([1, 2], async (id) => (reads.push(id), id === 1 ? 4 : 5))).toBe(4.5);
    expect(reads).toEqual([1, 2]);
  });

  it("a fractional ratio rounds the day's checkouts (4.6 x 3 runs = 14)", () => {
    const t = tallyRuns([run(1, 10, "Tests", "success"), run(2, 10, "Tests", "success"), run(3, 10, "Tests", "success")]);
    expect(checkoutsOfDay(t, () => 4.6).checkouts).toBe(14);
  });

  it("each day reads its own ratio: the same workflow counts 3 per run one day and 5 the next", async () => {
    const runs = { "2026-08-03": [run(1, 10, "Tests", "success"), run(2, 10, "Tests", "success")], "2026-08-12": [run(3, 10, "Tests", "success"), run(4, 10, "Tests", "success")] };
    const jobs = { 1: 3, 2: 3, 3: 5, 4: 5 };
    const api = { listDay: async (d) => runs[d], readJobs: async (id) => jobs[id] };
    expect((await countDay("2026-08-03", api)).checkouts).toBe(6);
    expect((await countDay("2026-08-12", api)).checkouts).toBe(10);
  });

  it("ghost runs never reach the count", async () => {
    const ghost = { ...run(7, 10, "Tests", "failure"), updated_at: "2026-11-05T00:00:00Z" };
    const api = { listDay: async () => [ghost, run(8, 10, "Tests", "success")], readJobs: async () => 5 };
    expect(await countDay("2026-10-21", api)).toMatchObject({ runs: 1, checkouts: 5 });
  });
});
