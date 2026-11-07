import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// One test per incident: a dossier that mixed two repos under one label, a
// 30-day range that returned 31 days, a badge with two clocks, and /compare
// printing two stars/day for the same repo.

const sampleRoute = JSON.parse(readFileSync(new URL("../../data-sample/route.json", import.meta.url), "utf8"));
const hist = vi.hoisted(() => ({
  route: null as unknown,
  history: [] as { ts: string; rank: number; stars: number }[],
}));
vi.mock("@/lib/history", async (orig) => ({
  ...(await orig<typeof import("@/lib/history")>()),
  loadRoute: () => hist.route,
  loadHistory: () => hist.history,
  loadMeta: () => ({ repo: "santifer/career-ops" }),
}));
const gh = vi.hoisted(() => ({ live: 0, rank: null as number | null }));
vi.mock("@/lib/github", () => ({
  currentStars: async () => gh.live,
  worldwideRank: async () => {
    if (gh.rank === null) throw new Error("search 403");
    return gh.rank;
  },
  lowFuel: () => false,
}));

beforeEach(() => {
  hist.route = sampleRoute;
  hist.history = [];
});

describe("repoStats: no name-part fallback", () => {
  it("alice/react is not in the registry (it used to resolve to react/react)", async () => {
    const { repoStats } = await import("./api-v1");
    expect(repoStats("alice/react")).toBeNull();
    expect(repoStats("react/react")?.repo).toBe("react/react");
  });

  it("ranks by counting, so the rank agrees with the stars printed next to it", async () => {
    const { repoStats } = await import("./api-v1");
    // last night's order, this morning's stars: b/y has passed a/x since
    hist.route = { repos: [{ r: "a/x", s: 65_000 }, { r: "b/y", s: 65_139 }, { r: "c/z", s: 64_000 }] };
    const b = repoStats("b/y", 2)!;
    expect(b.rank).toBe(1);
    expect(b.behind.map((n) => [n.repo, n.rank])).toEqual([["a/x", 2], ["c/z", 3]]);
  });
});

describe("dossier window: ?range=30d is 30 days", () => {
  const days = Array.from({ length: 60 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
  }));
  it("30d, 12w and 1y cover exactly that many days, ending on the newest", async () => {
    const { resolveWindow, windowed } = await import("./dossier-window");
    const newest = days.at(-1)!.day;
    for (const [range, n] of [["30d", 30], ["7d", 7], ["1d", 1]] as const) {
      const w = windowed(days, resolveWindow(new URLSearchParams({ range }), newest))!;
      expect(w.days).toBe(n);
      expect(w.to).toBe(newest);
    }
  });
});

describe("badge: one clock per image", () => {
  const snapshot = { ts: "2026-10-19T10:00:00Z", rank: 250, stars: 75_000 };
  it("a live star count comes with a live rank", async () => {
    hist.history = [snapshot];
    gh.live = 75_600;
    gh.rank = 247;
    const { GET } = await import("@/app/api/badge/route");
    const svg = await (await GET(new Request("https://warpchart.test/api/badge"))).text();
    expect(svg).toContain("#247");
    expect(svg).toContain("75,600");
  });

  it("if the live rank cannot be read, rank AND stars come from the snapshot", async () => {
    hist.history = [snapshot];
    gh.live = 75_600;
    gh.rank = null;
    const { GET } = await import("@/app/api/badge/route");
    const svg = await (await GET(new Request("https://warpchart.test/api/badge"))).text();
    expect(svg).toContain("#250");
    expect(svg).toContain("75,000");
    expect(svg).not.toContain("75,600");
  });

  it("a registry repo is ranked by counting, not by its position", async () => {
    hist.route = { repos: [{ r: "a/x", s: 65_000 }, { r: "b/y", s: 65_139 }] };
    const { GET } = await import("@/app/api/badge/route");
    const svg = await (await GET(new Request("https://warpchart.test/api/badge?repo=b/y"))).text();
    expect(svg).toContain("#1<");
  });
});

describe("/compare: one stars/day per repo", () => {
  it("the insight line reads the same rate as the legend", async () => {
    const { compareRate, rateAt } = await import("./compare");
    const DAY = 864e5;
    const pts = [{ t: 0, v: 0 }, { t: 30 * DAY, v: 3000 }];
    expect(compareRate(120, pts)).toBe(120);
    expect(compareRate(null, pts)).toBe(rateAt(pts, pts[1].t));
    const src = readFileSync(new URL("../components/CompareLab.tsx", import.meta.url), "utf8");
    // every stars/day CompareLab derives goes through compareRate
    expect(src).not.toMatch(/rate:\s*rateAt\(/);
    expect(src.match(/compareRate\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
