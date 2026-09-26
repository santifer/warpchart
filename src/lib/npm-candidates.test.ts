import { describe, expect, it } from "vitest";
import { npmCandidates } from "@/lib/npm-candidates";
import { allNamesOf } from "@/lib/aliases";
// the collector keeps its own copy of the alias helpers (it cannot import TS)
import { allNamesOf as collectorAllNamesOf } from "../../collector/lib.mjs";

describe("npm package candidates after a transfer", () => {
  // 2026-08-31 the repo moved to career-ops-hq; the installer is still
  // @santifer/career-ops. Guessing only @career-ops-hq/career-ops blanked the
  // npm channel for three weeks without a single error.
  it("tries every name the repo has carried, canonical first", () => {
    expect(npmCandidates("career-ops-hq", "career-ops", null)).toEqual([
      "@career-ops-hq/career-ops",
      "@santifer/career-ops",
    ]);
  });

  it("puts the repo's own public package first and never repeats a name", () => {
    expect(npmCandidates("career-ops-hq", "career-ops", "@santifer/career-ops")).toEqual([
      "@santifer/career-ops",
      "@career-ops-hq/career-ops",
    ]);
  });

  it("passes an unaliased repo through as its own scoped name", () => {
    expect(npmCandidates("someone", "tool", null)).toEqual(["@someone/tool"]);
  });
});

describe("alias helpers agree between the app and the collector", () => {
  it.each(["santifer/career-ops", "career-ops-hq/career-ops", "SANTIFER/Career-Ops"])("%s", (repo) => {
    const norm = (xs: Iterable<string>) => [...xs].map((x) => x.toLowerCase()).sort();
    expect(norm(allNamesOf(repo))).toEqual(norm(collectorAllNamesOf(repo)));
  });
});
