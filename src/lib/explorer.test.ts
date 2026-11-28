import { beforeEach, describe, expect, it, vi } from "vitest";

// An uncached deep-space scan used to run its GitHub stages one after another
// (meta -> rank -> search up -> search down -> velocity -> dossier -> npm).
// Only the ones that need an earlier answer may wait for it; everything else
// starts together. Failures must keep their meaning: a failed dossier is a
// null dossier, a failed rank or neighbor search fails the scan.

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const gh = vi.hoisted(() => ({
  repoLite: vi.fn(),
  worldwideRank: vi.fn(),
  searchNeighbors: vi.fn(),
  neighborsVelocity: vi.fn(),
  repoDossier: vi.fn(),
}));

vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/history", () => ({
  loadRoute: () => ({
    generated_at: "2026-10-19T00:00:00Z",
    repos: [
      { r: "apex/one", s: 500_000, v7: 100 },
      { r: "top/two", s: 400_000, v7: 50 },
      { r: "top/three", s: 300_000, v7: 40 },
    ],
  }),
  loadMeta: () => null,
  lastSnapshot: () => null,
  loadTimestamps: () => [],
  loadHistory: () => [],
  loadMilestones: () => null,
  loadForensics: () => null,
  loadAttribution: () => null,
  loadCatalog: () => null,
}));
vi.mock("@/lib/github", () => ({
  ...gh,
  lowFuel: () => false,
  npmDownloadsWindow: async () => null,
  npmDownloadsRange: async () => null,
}));
vi.mock("@/lib/npm-versions", () => ({
  npmLatestVersion: async () => null,
  npmVersionWeek: async () => null,
  recordedVersionWeek: async () => null,
}));
vi.mock("@/lib/traffic", () => ({ loadTrafficVault: async () => null }));

const RAW = { issuesOpened30: 1, issuesClosed30: 1, prsMerged30: 1, openIssues: 1, commits30: 1, releases: [], npmPkg: null };
const lite = { nameWithOwner: "deep/space", stargazerCount: 1200, forkCount: 10, description: null, primaryLanguage: null };

beforeEach(() => {
  for (const f of Object.values(gh)) f.mockReset();
});

describe("getExplorerData, deep space", () => {
  it("starts rank, neighbor search and dossier together once the repo resolved", async () => {
    const rank = deferred<number>();
    const search = deferred<string[]>();
    const dossier = deferred<typeof RAW>();
    gh.repoLite.mockResolvedValue(lite);
    gh.worldwideRank.mockReturnValue(rank.promise);
    gh.searchNeighbors.mockReturnValue(search.promise);
    gh.repoDossier.mockReturnValue(dossier.promise);
    gh.neighborsVelocity.mockResolvedValue([{ r: "deep/space", s: 1200, v: null, d: null, l: null }]);

    const { getExplorerData } = await import("@/lib/explorer");
    const run = getExplorerData("deep", "space");

    // none of the three has answered, and all three are already in flight
    await vi.waitFor(() => {
      expect(gh.worldwideRank).toHaveBeenCalledWith(1200);
      expect(gh.searchNeighbors).toHaveBeenCalledWith("deep/space", 1200);
      expect(gh.repoDossier).toHaveBeenCalledWith("deep", "space");
    }, { timeout: 500 });
    // velocity needs the neighbor names, so it waits for the search
    expect(gh.neighborsVelocity).not.toHaveBeenCalled();

    rank.resolve(4321);
    search.resolve([]);
    dossier.resolve(RAW);
    const data = await run;
    expect(data?.inputs.rank).toBe(4321);
    expect(data?.dossier?.issuesOpened30).toBe(1);
    expect(gh.repoDossier).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed dossier a null dossier, never a failed page", async () => {
    gh.repoLite.mockResolvedValue(lite);
    gh.worldwideRank.mockResolvedValue(4321);
    gh.searchNeighbors.mockResolvedValue([]);
    gh.repoDossier.mockRejectedValue(new Error("GitHub 502"));
    gh.neighborsVelocity.mockResolvedValue([{ r: "deep/space", s: 1200, v: null, d: null, l: null }]);
    const { getExplorerData } = await import("@/lib/explorer");
    const data = await getExplorerData("deep", "space");
    expect(data?.dossier).toBeNull();
    // an unmeasurable rate on an untracked repo stays what it was: 0 is all we know
    expect(data?.inputs.v7d).toBe(0);
  });

  it("still fails the scan when the rank cannot be read", async () => {
    gh.repoLite.mockResolvedValue(lite);
    gh.worldwideRank.mockRejectedValue(new Error("GitHub 403"));
    gh.searchNeighbors.mockResolvedValue([]);
    gh.repoDossier.mockResolvedValue(RAW);
    const { getExplorerData } = await import("@/lib/explorer");
    await expect(getExplorerData("deep", "space")).rejects.toThrow(/403/);
    expect(gh.neighborsVelocity).not.toHaveBeenCalled();
  });
});

describe("getExplorerData, top 1000", () => {
  it("runs the dossier alongside the velocity call", async () => {
    const vel = deferred<{ r: string; s: number; v: number | null; d: null; l: null }[]>();
    gh.neighborsVelocity.mockReturnValue(vel.promise);
    gh.repoDossier.mockResolvedValue(RAW);
    const { getExplorerData } = await import("@/lib/explorer");
    const run = getExplorerData("top", "three");
    await vi.waitFor(() => expect(gh.repoDossier).toHaveBeenCalledWith("top", "three"), { timeout: 500 });
    vel.resolve([{ r: "top/three", s: 300_100, v: null, d: null, l: null }]);
    const data = await run;
    expect(data?.dossier).not.toBeNull();
    expect(gh.repoDossier).toHaveBeenCalledTimes(1);
  });

  it("still returns the page when the velocity call fails (registry fallback)", async () => {
    gh.neighborsVelocity.mockRejectedValue(new Error("neighborsVelocity: no repo resolved"));
    gh.repoDossier.mockResolvedValue(RAW);
    const { getExplorerData } = await import("@/lib/explorer");
    const data = await getExplorerData("top", "three");
    expect(data?.degraded).toBe(true);
    expect(data?.dossier).not.toBeNull();
    // the registry's canonical 7-day rate, never a 0 from the failed call
    expect(data?.inputs.v7d).toBe(40);
  });
});
