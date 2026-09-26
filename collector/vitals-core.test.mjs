import { describe, expect, it } from "vitest";
import { derivePrAnalysis, gfiFromCounts, gfiQueries, rankMaintainers } from "./vitals-core.mjs";

const now = Date.parse("2026-09-26T12:00:00Z");
const DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString();
// a merged PR as GraphQL returns it (newest first in the sweep)
const pr = (author, createdMs, hours = 2, mergedBy = "santifer") => ({
  createdAt: iso(createdMs),
  mergedAt: iso(createdMs + hours * 36e5),
  author: author ? { login: author } : null,
  mergedBy: mergedBy ? { login: mergedBy } : null,
});

describe("derivePrAnalysis", () => {
  // 2026-07-28: the panel said "138 contributors" (the authors inside the PR
  // sample) and linked to the GitHub page that said 213.
  it("publishes the repo-wide contributor count, not the sample's", () => {
    const nodes = Array.from({ length: 138 }, (_, i) => pr(`dev${i}`, now - (i + 1) * 36e5));
    const { community } = derivePrAnalysis({ nodes, now, contributorsTotal: 213 });
    expect(community.contributors).toBe(213);
    expect(community.contributorsSampled).toBe(138);
  });

  it("falls back to the sample only when the real count could not be read", () => {
    const nodes = [pr("a", now - DAY), pr("b", now - 2 * DAY)];
    expect(derivePrAnalysis({ nodes, now, contributorsTotal: null }).community.contributors).toBe(2);
  });

  // A capped sweep cannot know who "returned" in its oldest month: the series
  // jumped from "1 → 7 → 17" to "0 → 18" overnight when the window shrank.
  it("drops the oldest month when the sweep hit its cap, keeps it when it did not", () => {
    const nodes = [
      pr("a", Date.parse("2026-09-10T00:00:00Z")),
      pr("b", Date.parse("2026-09-09T00:00:00Z")),
      pr("c", Date.parse("2026-08-20T00:00:00Z")),
    ];
    const capped = derivePrAnalysis({ nodes, now, want: 3 }).community.cohorts.map((c) => c.month);
    const whole = derivePrAnalysis({ nodes, now, want: 1000 }).community.cohorts.map((c) => c.month);
    expect(capped).toEqual(["2026-09"]);
    expect(whole).toEqual(["2026-08", "2026-09"]);
  });

  it("measures lead time over the last 90 days only (the old full-history median read Elite→High)", () => {
    const nodes = [pr("a", now - 5 * DAY, 2), pr("b", now - 6 * DAY, 4), pr("c", now - 200 * DAY, 1000)];
    const { leadTime } = derivePrAnalysis({ nodes, now });
    expect(leadTime.sample).toBe(2);
    expect(leadTime.tier).toBe("Elite");
    expect(leadTime.windowDays).toBe(90);
  });

  it("keeps bots out of contributors and maintainers", () => {
    const nodes = [pr("dependabot[bot]", now - DAY, 1, "github-actions"), pr("human", now - DAY)];
    const { community } = derivePrAnalysis({ nodes, now });
    expect(community.contributorsSampled).toBe(1);
    expect(community.maintainers).toEqual(["santifer"]);
  });
});

describe("rankMaintainers", () => {
  // 2026-09-15: a Set in insertion order made the newest merger "operate" the repo.
  it("orders by merge volume, never by who merged most recently", () => {
    const merges = new Map([["freptar0", 1], ["santifer", 50]]);
    expect(rankMaintainers(merges)).toEqual(["santifer", "freptar0"]);
  });

  it("breaks ties alphabetically so the field is stable between runs", () => {
    expect(rankMaintainers(new Map([["bob", 3], ["alice", 3]]))).toEqual(["alice", "bob"]);
  });
});

describe("good first issues: count openings, not signs", () => {
  it("asks GitHub for the free ones (no assignee, no linked PR)", () => {
    const q = gfiQueries("career-ops-hq/career-ops");
    expect(q.f).toContain("no:assignee -linked:pr");
    expect(q.f2).toContain("no:assignee -linked:pr");
    expect(q.q).not.toContain("no:assignee");
  });

  it("reports 1 free of 12 labeled, never 12 as if all were open doors", () => {
    const d = { a: { issueCount: 12 }, b: { issueCount: 0 }, c: { issueCount: 1 }, d: { issueCount: 0 } };
    expect(gfiFromCounts(d)).toEqual({ goodFirstIssues: 12, goodFirstIssuesFree: 1 });
  });

  it("says unknown (null) when any of the four searches did not answer, never 0", () => {
    const d = { a: { issueCount: 12 }, b: { issueCount: 0 }, c: null, d: { issueCount: 0 } };
    expect(gfiFromCounts(d)).toBeNull();
  });

  it("never lets the free count exceed the labeled one", () => {
    const d = { a: { issueCount: 3 }, b: { issueCount: 0 }, c: { issueCount: 5 }, d: { issueCount: 0 } };
    expect(gfiFromCounts(d).goodFirstIssuesFree).toBe(3);
  });
});
