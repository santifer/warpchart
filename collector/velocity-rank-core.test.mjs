import { describe, expect, it } from "vitest";
import { buildDays, dailyDeltas, historyCovers, mergeReconstructed, rankAmong, reconstructDays, repoDailyRanks, repoReconstructedRanks } from "./velocity-rank-core.mjs";

// A tiny universe: minUniverse is lowered so a handful of repos stand in for
// the 10k sweep; the rules are the same.
const opts = { top: 3, minUniverse: 3 };

describe("dailyDeltas", () => {
  it("only pairs CONSECUTIVE days: a gap is a hole, never two days ranked as one", () => {
    const d = dailyDeltas([["2026-10-01", 5, 100], ["2026-10-02", 5, 150], ["2026-10-04", 5, 400]]);
    expect(d).toEqual([{ day: "2026-10-01", to: "2026-10-02", gain: 50, rankTo: 5, step: null }]);
  });

  it("flags odysseus's purge and its restore as steps (real counts, 24 and 29 Jul)", () => {
    const s = [
      ["2026-07-23", 900, 61_400], ["2026-07-24", 2400, 39_600], // -21,800: a purge
      ["2026-07-25", 2400, 39_720], ["2026-07-28", 2400, 40_000],
      ["2026-07-29", 900, 61_863], // +21,863: the stars given back
    ];
    const d = dailyDeltas(s);
    expect(d.find((x) => x.day === "2026-07-23").step).toBe("drop");
    expect(d.find((x) => x.day === "2026-07-24").step).toBe(null);
    // the restore lands after a GAP (25 -> 28 not recorded consecutively): it
    // still has to be recognised, which is why drops are remembered across gaps
    expect(d.find((x) => x.day === "2026-07-28").step).toBe("restore");
  });

  it("a big honest rise (no earlier drop) is growth, not a step", () => {
    const d = dailyDeltas([["2026-08-20", 300, 30_000], ["2026-08-21", 280, 31_500]]);
    expect(d[0]).toMatchObject({ gain: 1500, step: null });
  });
});

describe("buildDays", () => {
  const universe = [
    ["a/a", [["2026-10-01", 1, 9000], ["2026-10-02", 1, 9300]]],
    ["b/b", [["2026-10-01", 2, 8000], ["2026-10-02", 2, 8100]]],
    ["c/c", [["2026-10-01", 3, 7000], ["2026-10-02", 3, 7050]]],
    ["d/d", [["2026-10-01", 4, 6000], ["2026-10-02", 4, 6900]]], // 4th: outside a top 3
  ];

  it("ranks the top N by stars at the CLOSE of the day, highest gain first", () => {
    const [day] = buildDays(universe, opts);
    expect(day).toEqual({ day: "2026-10-01", to: "2026-10-02", n: 3, gains: [300, 100, 50] });
  });

  it("drops a day whose sweep was truncated (2026-09-03 kept 4,039 of ~10,000)", () => {
    const short = universe.map(([r, s]) => [r, r === "a/a" ? s : s.filter((p) => p[0] !== "2026-10-02")]);
    expect(buildDays(short, opts)).toEqual([]);
  });

  it("drops a day whose top N has HOLES even though the 10k count passes (2026-06-29: 9,334 points, ranks 10, 47, 68... missing)", () => {
    // b/b's point on the close day is lost (a shard that never got the day):
    // the remaining repos would each read a place better than they were
    const holed = universe.map(([r, s]) => [r, r === "b/b" ? s.filter((p) => p[0] !== "2026-10-02") : s]);
    expect(buildDays(holed, { top: 3, minUniverse: 3 })).toEqual([]);
  });

  it("leaves a restore out of the list: +21,863 at #1 would push every real repo down a place", () => {
    const withRestore = [
      ...universe.slice(0, 3),
      ["o/odysseus", [["2026-09-29", 9, 40_000], ["2026-09-30", 9, 18_000], ["2026-10-01", 4, 18_100], ["2026-10-02", 4, 40_000]]],
    ];
    const [day] = buildDays(withRestore, { top: 4, minUniverse: 3 }).filter((d) => d.day === "2026-10-01");
    expect(day.gains).toEqual([300, 100, 50]);
    // without the rule, b/b would read #3 instead of #2
    expect(rankAmong(day.gains, 100)).toBe(2);
  });
});

describe("rankAmong", () => {
  const gains = [2605, 900, 204, 204, 150, 12, -3];
  it("counts only strictly more: a tie never costs a place, the repo's own gain is not double-counted", () => {
    expect(rankAmong(gains, 204)).toBe(3);
    expect(rankAmong(gains, 2605)).toBe(1);
    expect(rankAmong(gains, 9999)).toBe(1);
    expect(rankAmong(gains, -10)).toBe(8);
  });
});

describe("repoDailyRanks", () => {
  it("flags a repo OUTSIDE the top 1,000: its rank is where it would have placed, not a place it held", () => {
    const [row] = repoDailyRanks([{ day: "2026-09-01", to: "2026-09-02", n: 3, gains: [500, 160, 90] }],
      [["2026-09-01", 4200, 9_000], ["2026-09-02", 4180, 9_200]]);
    expect(row).toMatchObject({ rank: 2, gain: 200, inTop: false });
  });

  const days = [
    { day: "2026-09-01", to: "2026-09-02", n: 3, gains: [500, 160, 90] },
    { day: "2026-09-02", to: "2026-09-03", n: 3, gains: [400, 120, 60] },
  ];

  it("follows a repo through its transfer: the merged series has no hole on 1-2 Sep", () => {
    // santifer/career-ops until 1 Sep, career-ops-hq/career-ops from 2 Sep,
    // merged by the caller across every name (allNamesOf)
    const merged = [["2026-09-01", 260, 66_000], ["2026-09-02", 258, 66_160], ["2026-09-03", 257, 66_280]];
    expect(repoDailyRanks(days, merged)).toEqual([
      { day: "2026-09-01", rank: 2, gain: 160, n: 3, inTop: true },
      { day: "2026-09-02", rank: 2, gain: 120, n: 3, inTop: true },
    ]);
  });

  it("says WHY a day has no rank instead of drawing it as a bad day", () => {
    const rows = repoDailyRanks(days, [["2026-09-02", 9, 50_000], ["2026-09-03", 9, 40_000]]);
    expect(rows[0]).toMatchObject({ rank: null, why: "unrecorded" });
    expect(rows[1]).toMatchObject({ rank: null, why: "step" });
  });
});

describe("reconstructDays (before the moat, from /stargazers/history)", () => {
  const days = ["2026-04-04", "2026-04-05", "2026-04-06"];
  // career-ops-like: born on 4 Apr, ~7,000/day; two old giants; a small one
  const repos = {
    "career-ops-hq/career-ops": { end: 19_249, g: [4_857, 7_353, 7_039] },
    "big/old": { end: 50_300, g: [100, 100, 100] },
    "mid/old": { end: 15_060, g: [20, 20, 20] },
    "small/x": { end: 3_000, g: [500, 500, 500] },
  };
  const r = reconstructDays(days, repos, { top: 3 });

  it("walks stars back from the window's end: membership changes as a newborn repo climbs", () => {
    // 4 Apr: career-ops had 4,857 at the end of the day -> 3rd of {50.1k, 15.02k, 4.857k, 2k}
    expect([...r[0].inTopOf].sort()).toEqual(["big/old", "career-ops-hq/career-ops", "mid/old"]);
    expect(r[0].gains).toEqual([4_857, 100, 20]);
  });

  it("ranks the repo on each day and flags the rows as reconstructed", () => {
    const rows = repoReconstructedRanks(r, repos, ["santifer/career-ops", "career-ops-hq/career-ops"]);
    expect(rows.map((x) => x.rank)).toEqual([1, 1, 1]);
    expect(rows.every((x) => x.reconstructed && x.inTop)).toBe(true);
    expect(repoReconstructedRanks(r, repos, ["nobody/here"])).toEqual([]);
  });

  it("days before a repo existed are 'unborn', never drawn as #1000", () => {
    const rows = repoReconstructedRanks(reconstructDays(days, { ...repos, "new/born": { end: 900, g: [0, 0, 900] } }), { ...repos, "new/born": { end: 900, g: [0, 0, 900] } }, ["new/born"]);
    expect(rows.map((x) => x.why ?? x.rank)).toEqual(["unborn", "unborn", 2]); // 900 that day, behind career-ops's 7,039
  });

  it("a day WITH stars is never 'unborn', even when end walked back below zero (the rival lost 43 days that way)", () => {
    const odd = { ...repos, "rival/x": { end: 500, g: [600, 300, 100] } }; // end < sum(g)
    const rows = repoReconstructedRanks(reconstructDays(days, odd), odd, ["rival/x"]);
    expect(rows.map((x) => x.why ?? "ranked")).toEqual(["ranked", "ranked", "ranked"]);
  });

  it("a repo not yet born has 0 stars and is never in the top", () => {
    const r2 = reconstructDays(days, { ...repos, "new/born": { end: 900, g: [0, 0, 900] } }, { top: 5 });
    expect(r2[0].inTopOf.has("new/born")).toBe(false);
    expect(r2[2].inTopOf.has("new/born")).toBe(true);
  });
});

describe("mergeReconstructed (recorded table + reconstructed fill)", () => {
  // career-ops around the 3 Sep truncated sweep (4,039 of 10k): the table has
  // 1 Sep and 4 Sep, never 2-3 Sep. Ranks/gains are the real ones.
  const rec = (day, rank, gain) => ({ day, rank, gain, n: 1000, inTop: true });
  const rb = (day, rank, gain) => ({ day, rank, gain, n: 1000, inTop: true, reconstructed: true });
  const recorded = [rec("2026-09-01", 84, 140), rec("2026-09-04", 101, 109), rec("2026-09-05", 96, 112)];
  const rebuilt = [
    rb("2026-08-30", 0, 0), // stands in for the pre-moat stretch
    rb("2026-09-01", 80, 150),
    rb("2026-09-02", 75, 164),
    rb("2026-09-03", 97, 132),
    rb("2026-09-04", 102, 90),
    rb("2026-09-06", 90, 120), // past the table's last day
  ];

  it("fills the days the table lacks, and a recorded day always wins", () => {
    const m = mergeReconstructed(recorded, rebuilt);
    expect(m.map((p) => `${p.day.slice(5)}${p.reconstructed ? "r" : ""}#${p.rank}`)).toEqual([
      "08-30r#0", "09-01#84", "09-02r#75", "09-03r#97", "09-04#101", "09-05#96",
    ]);
  });

  it("never adds a day past the table's last one, and drops unborn rows", () => {
    const m = mergeReconstructed(recorded, [...rebuilt, { day: "2026-08-29", rank: null, gain: null, n: 1000, why: "unborn", reconstructed: true }]);
    expect(m.some((p) => p.day === "2026-09-06" || p.day === "2026-08-29")).toBe(false);
  });

  it("a repo that joined the top 10k later gets no lone fills before its first ranked day", () => {
    const late = [
      { day: "2026-09-01", rank: null, gain: null, n: 1000, why: "unrecorded" },
      { day: "2026-09-04", rank: 300, gain: 40, n: 1000, inTop: false },
      { day: "2026-09-05", rank: 280, gain: 45, n: 1000, inTop: false },
    ];
    const m = mergeReconstructed(late, [rb("2026-08-30", 900, 3), rb("2026-09-02", 700, 5), rb("2026-09-03", 600, 8)]);
    // 30 Aug is before the table (kept); 2-3 Sep sit before its first ranked day (dropped)
    expect(m.map((p) => p.day)).toEqual(["2026-08-30", "2026-09-01", "2026-09-04", "2026-09-05"]);
  });

  it("with no reconstruction, it is the recorded table as it was", () => {
    expect(mergeReconstructed(recorded, [])).toEqual(recorded);
  });
});

describe("historyCovers (one page of /stargazers/history)", () => {
  // xai-org/grok-build, created 14 Jul 2026: 15 weeks from Sun 12 Jul, no
  // next page, adding up to its 27,507 stars (real, 23 Oct)
  const born = Array.from({ length: 15 }, (_, i) => ({ week: 1783814400 + i * 7 * 86400, days: [0, 0, 0, 0, 0, 0, 0], total: 0 }));
  born[1].days = [27507, 0, 0, 0, 0, 0, 0];
  const from = "2026-04-01";

  it("a repo born inside the window is its whole history: covered", () => {
    expect(historyCovers(born, { more: false, from, stars: 27049 }).ok).toBe(true);
  });

  it("an empty 200 is never 'no stars' (Math.min() of nothing is Infinity)", () => {
    expect(historyCovers([], { more: false, from, stars: 50000 })).toEqual({ ok: false, why: "empty history" });
  });

  it("a cut-short answer without a next page does not add up: refused", () => {
    const cut = born.slice(5); // the 27,507 week is gone
    expect(historyCovers(cut, { more: false, from, stars: 27049 }).ok).toBe(false);
  });

  it("page 1 of an older repo that no longer reaches FROM: refused", () => {
    expect(historyCovers(born, { more: true, from, stars: 27049 }).ok).toBe(false);
  });

  it("a page that reaches FROM is covered", () => {
    const old = [{ week: Date.parse("2026-03-29T00:00:00Z") / 1000, days: [1, 1, 1, 1, 1, 1, 1], total: 7 }];
    expect(historyCovers(old, { more: true, from, stars: 99999 }).ok).toBe(true);
  });
});
