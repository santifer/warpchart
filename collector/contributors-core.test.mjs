import { describe, expect, it } from "vitest";
import { calibrateToLive, creditCommitAuthors, creditGithub, githubCurve, githubSeries } from "./contributors-core.mjs";

// Shapes taken from career-ops on 2026-10-11 (logins are public, as on GitHub).
describe("githubSeries: GitHub's own contributor rule", () => {
  const build = () => {
    const gh = {};
    // a regular author
    creditGithub(gh, "Jarvis-J-Jacob", "2026-10-09T08:00:00Z");
    // the manifesto service account signs as author, the signer rides in a
    // Co-authored-by trailer: GitHub counts BOTH (docs(signatures): add @JohnFScha)
    creditGithub(gh, "careerops-ledger", "2026-10-05T10:00:00Z");
    creditGithub(gh, "JohnFScha", "2026-10-05T10:00:00Z", { co: true });
    // bots and AI accounts count: GitHub's graph lists claude and [bot]s
    creditGithub(gh, "dependabot[bot]", "2026-05-01T00:00:00Z");
    creditGithub(gh, "claude", "2026-06-01T00:00:00Z", { co: true });
    // one-commit author past the 500-email cap: anonymous on GitHub
    creditGithub(gh, "yiziff", "2026-10-01T00:00:00Z");
    return gh;
  };
  const listed = ["jarvis-j-jacob", "careerops-ledger", "dependabot[bot]"];

  it("counts authors and linked co-authors, bots and AI accounts included", () => {
    const s = githubSeries(build(), listed);
    expect(s.total).toBe(5);
    expect(s.capped).toBe(1);
    expect(s.capApplied).toBe(true);
  });

  it("drops an author GitHub no longer links (the 500-email cap)", () => {
    // the 30 missing people of 2026-10-11 were exactly this shape
    const withCap = githubSeries(build(), listed).total;
    const noCap = githubSeries(build(), null).total;
    expect(noCap - withCap).toBe(1);
  });

  it("keeps a capped author who is also credited as a co-author", () => {
    const gh = build();
    creditGithub(gh, "yiziff", "2026-10-02T00:00:00Z", { co: true });
    expect(githubSeries(gh, listed).total).toBe(6);
  });

  it("dates each person by their FIRST credit and is one person whatever the case", () => {
    const gh = {};
    creditGithub(gh, "AdityaP", "2026-10-11T00:00:00Z");
    creditGithub(gh, "adityap", "2026-09-20T00:00:00Z", { co: true });
    const s = githubSeries(gh, null);
    expect(s.total).toBe(1);
    expect(s.daily).toEqual([["2026-09-20", 1]]);
  });

  it("is a daily cumulative series in day order", () => {
    const s = githubSeries(build(), listed);
    expect(s.daily).toEqual([
      ["2026-05-01", 1],
      ["2026-06-01", 2],
      ["2026-10-05", 4],
      ["2026-10-09", 5],
    ]);
  });
});

describe("creditCommitAuthors", () => {
  it("credits the first node as the AUTHOR, so the 500-email cap still applies to it", () => {
    // raymondwilliamskc, 2026-09-28: one commit, past the cap, carrying a
    // trailer. Treated as a co-author it escaped the cap (dry run: 620 vs 615).
    const gh = {};
    creditCommitAuthors(
      gh,
      [{ user: { login: "raymondwilliamskc" } }, { user: { login: "careerops-ledger" } }],
      "2026-09-28T18:29:21Z",
    );
    expect(gh.raymondwilliamskc.co).toBe(false);
    expect(gh["careerops-ledger"].co).toBe(true);
    expect(githubSeries(gh, ["careerops-ledger"]).total).toBe(1);
  });

  it("skips trailers GitHub links to no account", () => {
    const gh = {};
    creditCommitAuthors(gh, [{ user: { login: "a" } }, { user: null }], "2026-10-01T00:00:00Z");
    expect(Object.keys(gh)).toEqual(["a"]);
  });
});

describe("calibrateToLive", () => {
  // career-ops 2026-10-11: rebuilt 616, GitHub shows 614
  const daily = [
    ["2026-04-04", 1],
    ["2026-04-07", 10],
    ["2026-07-01", 300],
    ["2026-10-11", 616],
  ];

  it("ends exactly on the number GitHub shows", () => {
    const c = calibrateToLive(daily, 614);
    expect(c.daily.at(-1)).toEqual(["2026-10-11", 614]);
    expect(c.rebuilt).toBe(616);
    expect(c.residual).toBe(-2);
  });

  it("keeps whole people and never goes down", () => {
    const c = calibrateToLive(daily, 614);
    for (let i = 0; i < c.daily.length; i++) {
      expect(Number.isInteger(c.daily[i][1])).toBe(true);
      if (i) expect(c.daily[i][1]).toBeGreaterThanOrEqual(c.daily[i - 1][1]);
    }
    expect(c.daily[0][1]).toBe(1);
  });

  it("refuses to stretch a rebuild that measures something else", () => {
    // 643 vs 614 = the rebuild WITHOUT the email cap (4.5% off): a 5% bar let
    // it through (review, 2026-10-11). Plain authors (506) are 18% off.
    expect(calibrateToLive([["2026-10-11", 643]], 614)).toBeNull();
    expect(calibrateToLive([["2026-10-11", 506]], 614)).toBeNull();
  });

  it("returns null without a live figure, never a guess", () => {
    expect(calibrateToLive(daily, null)).toBeNull();
    expect(calibrateToLive([], 614)).toBeNull();
  });
});

// career-ops 2026-10-16 (real run 38893893115): capped rebuild 620, no-cap
// rebuild 672, GitHub's sidebar 634 (2.26% off the capped one). The chart fell
// back to "516 authors" although 634 sits inside the bracket the cap opens.
describe("calibrateToLive brackets the 500-email cap's blind spot", () => {
  const daily = [
    ["2026-04-04", 1],
    ["2026-07-01", 300],
    ["2026-10-16", 620],
  ];
  it("calibrates a live figure between the capped and uncapped rebuilds", () => {
    const c = calibrateToLive(daily, 634, 2, { uncapped: 672 });
    expect(c).not.toBeNull();
    expect(c.daily.at(-1)).toEqual(["2026-10-16", 634]);
    expect(c.residual).toBe(14);
  });
  it("still refuses past the uncapped rebuild (+2%) or below the capped one (-2%)", () => {
    expect(calibrateToLive(daily, 700, 2, { uncapped: 672 })).toBeNull();
    expect(calibrateToLive(daily, 600, 2, { uncapped: 672 })).toBeNull();
  });
  it("does not open when the uncapped rebuild is implausibly far (suspect census)", () => {
    expect(calibrateToLive(daily, 700, 2, { uncapped: 760 })).toBeNull(); // 22.6% wide
  });
  it("without an uncapped figure the old 2% rule stands", () => {
    expect(calibrateToLive(daily, 634)).toBeNull();
  });
});

// career-ops 2026-10-30 (real store, collect run 19:15Z): capped rebuild 647,
// no-cap rebuild 749, GitHub's sidebar 749. The bracket (15.8%) passed
// MAX_CAP_BRACKET_PCT, calibration refused, and the panel fell back to
// "AUTHORS 578 / + CO-AUTHORED 792". Santiago saw it on his phone.
describe("githubCurve: GitHub's count, never another one", () => {
  const series = {
    githubDaily: [["2026-04-04", 1], ["2026-07-01", 300], ["2026-10-30", 647]],
    githubUncappedDaily: [["2026-04-04", 1], ["2026-07-01", 330], ["2026-10-30", 749]],
    githubCapApplied: true,
    githubUncapped: 749,
  };
  it("draws the uncapped rebuild when it lands on GitHub's figure", () => {
    const c = githubCurve(series, 749);
    expect(c).not.toBeNull();
    expect(c.basis).toBe("uncapped");
    expect(c.daily.at(-1)).toEqual(["2026-10-30", 749]);
    expect(c.residual).toBe(0);
  });
  it("prefers the capped rebuild while it calibrates", () => {
    const c = githubCurve({ ...series, githubUncapped: 672, githubDaily: [["2026-10-16", 620]] }, 634);
    expect(c.basis).toBe("capped");
  });
  it("refuses when neither rebuild matches the live figure", () => {
    expect(githubCurve(series, 900)).toBeNull();
    expect(githubCurve(series, null)).toBeNull();
  });
  it("githubSeries returns the no-cap curve ending on the no-cap total", () => {
    const gh = { a: { first: "2026-04-01T00:00:00Z", co: false }, b: { first: "2026-05-01T00:00:00Z", co: false } };
    const s = githubSeries(gh, ["a"]);
    expect(s.total).toBe(1);
    expect(s.uncappedDaily.at(-1)).toEqual(["2026-05-01", 2]);
  });
});

describe("githubCurve edges (review 2026-10-30)", () => {
  const base = {
    githubDaily: [["2026-04-04", 1], ["2026-07-01", 300], ["2026-10-30", 647]],
    githubUncappedDaily: [["2026-04-04", 1], ["2026-07-01", 330], ["2026-10-30", 749]],
    githubCapApplied: true,
    githubUncapped: 749,
  };
  it("draws the nearer rebuild when GitHub sits inside an outgrown bracket", () => {
    const c = githubCurve(base, 700);
    expect(c.basis).toBe("bracket");
    expect(c.daily.at(-1)).toEqual(["2026-10-30", 700]);
    const d = githubCurve(base, 660);
    expect(d.basis).toBe("bracket");
    expect(d.rebuilt).toBe(647);
  });
  it("never falls back without the cap list (githubDaily is already uncapped)", () => {
    expect(githubCurve({ ...base, githubCapApplied: false, githubDaily: [["2026-10-30", 600]] }, 749)).toBeNull();
  });
  it("refuses outside the bracket", () => {
    expect(githubCurve(base, 620)).toBeNull(); // 4% under the capped rebuild
    expect(githubCurve(base, 800)).toBeNull();
  });
});
