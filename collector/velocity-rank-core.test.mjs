import { describe, expect, it } from "vitest";
import { buildDays, dailyDeltas, rankAmong, reconstructDays, repoDailyRanks, repoReconstructedRanks } from "./velocity-rank-core.mjs";

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
