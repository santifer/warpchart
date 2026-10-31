import { describe, expect, it } from "vitest";
// The collector's rules (dependency-free .mjs) and the app's TypeScript twins.
// A drift between a twin pair never throws: a different shard hash reads an
// empty shard ("never ranked"), a different milestone list moves every gate.
// Each test imports BOTH sides.
import * as rules from "../../collector/rules.mjs";
import { nextMilestones as collectorMilestones } from "../../collector/lib.mjs";
import { shardOf, SHARDS } from "./rank-history";
import { nextMilestones } from "./milestones";
import { canonicalVelocity } from "./velocity";
import { rankByStars, rankQuery, rankedRegistry } from "./rank";

// Real registry names (mixed case, dots, dashes, digits) plus edge cases.
const NAMES = [
  "santifer/career-ops", "career-ops-hq/career-ops", "facebook/react", "hiyouga/LlamaFactory",
  "chrislgarry/Apollo-11", "vercel/next.js", "a/b", "A/B", "x_y/z.z-1", "torvalds/linux",
  ...Array.from({ length: 500 }, (_, i) => `owner${i}/repo-${(i * 7919) % 1000}`),
];

describe("parity: shard hash (src/lib/rank-history.ts vs collector/rules.mjs)", () => {
  it("same shard count", () => {
    expect(SHARDS).toBe(rules.SHARDS);
  });
  it("same shard for every name, case-insensitively", () => {
    for (const n of NAMES) {
      expect(shardOf(n)).toBe(rules.shardOf(n));
      expect(shardOf(n.toUpperCase())).toBe(shardOf(n));
    }
  });
  it("pins known values (a change here re-shards the stored history)", () => {
    expect([shardOf("santifer/career-ops"), shardOf("career-ops-hq/career-ops")]).toEqual([27, 0]);
  });
});

describe("parity: milestones (src/lib/milestones.ts vs collector)", () => {
  it("same gates for every rank from 1 to 20,000", () => {
    for (let r = -1; r <= 20_000; r++) expect(nextMilestones(r)).toEqual(rules.nextMilestones(r));
    for (const r of [409, 101, 4870, 10, 2]) expect(nextMilestones(r, 6)).toEqual(rules.nextMilestones(r, 6));
  });
  it("collector/lib.mjs exports the shared one, not a copy", () => {
    expect(collectorMilestones).toBe(rules.nextMilestones);
  });
});

describe("parity: canonical velocity (src/lib/velocity.ts vs collector)", () => {
  const cases = [
    { v7: 12.5, v: 40 }, { v7: null, v: 40 }, { v: 3 }, { v7: 0, v: 9 }, { v7: null, v: null }, {},
    { v7: -2, v: 5 },
  ];
  it("v7, else v, else null: same on both sides", () => {
    for (const c of cases) expect(canonicalVelocity(c)).toBe(rules.canonicalVelocity(c));
  });
});

describe("parity: one rank definition", () => {
  const repos = [{ s: 900 }, { s: 500 }, { s: 500 }, { s: 120 }, { s: 99 }];
  it("same question to GitHub on both sides", () => {
    for (const s of [0, 1, 65_139, 1e6]) expect(rankQuery(s)).toBe(rules.rankQuery(s));
  });
  it("same registry count on both sides", () => {
    for (const s of [1000, 900, 700, 500, 120, 99, 0]) expect(rankByStars(repos, s)).toBe(rules.rankByStars(repos, s));
  });
  it("rankedRegistry: current star order, ranks equal to the count above", () => {
    // the registry's order is last night's; its stars are this morning's
    const route = [
      { r: "a/x", s: 65_000 }, { r: "b/y", s: 65_139 }, { r: "c/z", s: 64_000 }, { r: "d/w", s: 64_000 },
    ];
    const ranked = rankedRegistry(route);
    expect(ranked.map((p) => [p.r, p.rank])).toEqual([["b/y", 1], ["a/x", 2], ["c/z", 3], ["d/w", 3]]);
    for (const p of ranked) expect(p.rank).toBe(rankByStars(route, p.s));
  });
});
