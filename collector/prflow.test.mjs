import { describe, expect, it } from "vitest";
import { buildFlow } from "./prflow.mjs";

const pr = (createdAt, extra = {}) => ({
  createdAt,
  mergedAt: null,
  closedAt: null,
  state: "OPEN",
  author: { login: "someone", __typename: "User" },
  ...extra,
});

// The queue at a day's close must follow from the day before and the day's own
// traffic. If this identity breaks, the bars and the line disagree on screen.
const assertQueueIdentity = (days) => {
  let prev = 0;
  for (const [day, o, m, x, open] of days) {
    expect(open, `queue identity broken on ${day}`).toBe(prev + o - m - x);
    prev = open;
  }
};

describe("buildFlow", () => {
  const now = Date.parse("2026-09-25T15:00:00Z");
  const pulls = [
    pr("2026-09-22T10:00:00Z", { mergedAt: "2026-09-23T09:00:00Z", closedAt: "2026-09-23T09:00:00Z", state: "MERGED" }),
    pr("2026-09-22T11:00:00Z", { closedAt: "2026-09-24T08:00:00Z", state: "CLOSED" }),
    // closed once, then reopened: it is back in the queue, never "closed"
    pr("2026-09-23T12:00:00Z", { closedAt: "2026-09-24T00:00:00Z", state: "OPEN" }),
    pr("2026-09-23T13:00:00Z", { author: { login: "dependabot[bot]", __typename: "Bot" } }),
    // created today: the day in progress is left out until it closes
    pr("2026-09-25T09:00:00Z"),
  ];

  it("leaves the UTC day in progress out (a day closes at 00:00Z)", () => {
    const flow = buildFlow(pulls, now);
    expect(flow.days.map((d) => d[0])).toEqual(["2026-09-22", "2026-09-23", "2026-09-24"]);
  });

  it("counts merged as merged (never closed) and a reopened PR as still open", () => {
    const { days, botsExcluded, humanPrs } = buildFlow(pulls, now);
    expect(days).toEqual([
      // median age of the open queue at each close, in days (0.56 · 1.02 · 1.5)
      ["2026-09-22", 2, 0, 0, 2, 1],
      ["2026-09-23", 1, 1, 0, 2, 1],
      ["2026-09-24", 0, 0, 1, 1, 2],
    ]);
    expect(botsExcluded).toBe(1);
    expect(humanPrs).toBe(4);
  });

  it("keeps the queue identity open(d) = open(d-1) + opened - merged - closed on random traffic", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const base = Date.parse("2026-06-01T00:00:00Z");
    const random = Array.from({ length: 400 }, () => {
      const c = base + rnd() * 100 * 864e5;
      const r = rnd();
      if (r < 0.5) {
        const m = new Date(c + rnd() * 20 * 864e5).toISOString();
        return pr(new Date(c).toISOString(), { mergedAt: m, closedAt: m, state: "MERGED" });
      }
      if (r < 0.7) return pr(new Date(c).toISOString(), { closedAt: new Date(c + rnd() * 20 * 864e5).toISOString(), state: "CLOSED" });
      return pr(new Date(c).toISOString());
    });
    const flow = buildFlow(random, Date.parse("2026-09-26T06:00:00Z"));
    assertQueueIdentity(flow.days);
  });

  it("returns null when there are no human PRs", () => {
    expect(buildFlow([pr("2026-09-01T00:00:00Z", { author: { login: "renovate[bot]" } })], now)).toBeNull();
  });
});
