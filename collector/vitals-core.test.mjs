import { describe, expect, it } from "vitest";
import {
  adoptionFromVault,
  derivePrAnalysis,
  gfiFromCounts,
  gfiQueries,
  parseSidebarContributors,
  rankMaintainers,
} from "./vitals-core.mjs";

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

  // 2026-10-11: the panel said "463 contributors" (REST /contributors, which
  // stops naming authors after 500 emails) and linked to GitHub, which said 611.
  it("reads the count GitHub shows on the repo page", () => {
    expect(parseSidebarContributors({ contributors: { contributorCount: 611 } })).toBe(611);
    expect(parseSidebarContributors({ contributors: {} })).toBeNull();
    expect(parseSidebarContributors(null)).toBeNull();
    expect(parseSidebarContributors({ contributors: { contributorCount: 0 } })).toBeNull();
  });

  it("publishes no count rather than the sample when GitHub's could not be read", () => {
    const nodes = [pr("a", now - DAY), pr("b", now - 2 * DAY)];
    const { community } = derivePrAnalysis({ nodes, now, contributorsTotal: null });
    expect(community.contributors).toBeNull();
    expect(community.contributorsSampled).toBe(2);
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

describe("adoptionFromVault", () => {
  const today = "2026-08-13";
  const days = (from, n) =>
    Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10));
  // the vault as traffic.mjs writes it: per-day {c, u}, plus GitHub's own
  // deduplicated 14-day reading and the day it was taken
  const vaultOf = (keys, { views = { c: 3000, u: 1000 }, clones = { c: 2600, u: 1300 }, at = "2026-08-13" } = {}) => ({
    views: Object.fromEntries(keys.map((d) => [d, { ...views }])),
    clones: Object.fromEntries(keys.map((d) => [d, { ...clones }])),
    uniq14: { cloners: 29_837, visitors: 40_000, at },
  });

  // 2026-08-13: the dossier stopped summing per-day uniques into "unique
  // cloners" (91,685 summed vs 29,837 deduplicated), but /api/v1/dossier kept
  // publishing the same sum for the week as adoption.uniqueClonersWeek.
  it("counts the week's clone events, and no summed uniques", () => {
    const ad = adoptionFromVault(vaultOf(days("2026-08-01", 13)), today);
    expect(ad.clonesWeek).toBe(7 * 2600);
    expect(ad).not.toHaveProperty("uniqueClonersWeek");
    expect(ad).not.toHaveProperty("clonesPerCloner");
    expect(ad.cloneConvPct).toBe(130);
  });

  // Windows are temporal, never by count: with a hole in the vault, the last 7
  // ENTRIES reached back three weeks and still called it a week.
  it("is the 7 UTC days before today, not the last 7 entries", () => {
    const old = days("2026-07-20", 7).map((d) => [d, { c: 1, u: 1 }]);
    const vault = vaultOf(days("2026-08-06", 7));
    Object.assign(vault.clones, Object.fromEntries(old));
    Object.assign(vault.views, Object.fromEntries(old));
    // today's partial day never counts
    vault.clones[today] = { c: 999_999, u: 999_999 };
    vault.views[today] = { c: 999_999, u: 999_999 };
    expect(adoptionFromVault(vault, today).clonesWeek).toBe(7 * 2600);
  });

  it("is null for a vault that stopped collecting, never a partial week", () => {
    const stale = vaultOf(days("2026-07-25", 14), { at: "2026-08-07" });
    expect(adoptionFromVault(stale, today)).toBeNull();
  });

  it("reads a day GitHub answered for and left out as zero", () => {
    const keys = days("2026-08-06", 7).filter((d) => d !== "2026-08-09");
    expect(adoptionFromVault(vaultOf(keys), today).clonesWeek).toBe(6 * 2600);
    const unanswered = vaultOf(keys);
    delete unanswered.uniq14;
    expect(adoptionFromVault(unanswered, today)).toBeNull();
  });

  it("is null without a vault", () => {
    expect(adoptionFromVault(null, today)).toBeNull();
    expect(adoptionFromVault({ views: {} }, today)).toBeNull();
  });
});
