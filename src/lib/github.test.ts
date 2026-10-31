import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onlyWholeAliasesMissing as collectorRule } from "../../collector/lib.mjs";

// The web app's GitHub client must agree with the collector's on what an
// unmeasurable window is (collector/lib.test.mjs has the twin of these).

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const node = (nameWithOwner: string, stargazerCount: number, edges: { starredAt: string }[] = []) => ({
  nameWithOwner,
  stargazerCount,
  description: null,
  primaryLanguage: null,
  stargazers: { edges },
});

const saved: Record<string, string | undefined> = {};
const KEYS = ["GITHUB_TOKEN", "GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_INSTALLATION_ID"];

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.GITHUB_TOKEN = "pat";
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  delete process.env.GITHUB_APP_INSTALLATION_ID;
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("neighborsVelocity (web twin of reposVelocity)", () => {
  it("reads an empty stargazer window on a starred repo as null, a starless one as 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { data: { r0: node("big/repo", 61000), r1: node("new/repo", 0) } })),
    );
    const { neighborsVelocity } = await import("@/lib/github");
    const out = await neighborsVelocity(["big/repo", "new/repo"], Date.parse("2026-09-26T12:00:00Z"));
    expect(out.find((r) => r.r === "big/repo")?.v).toBeNull();
    expect(out.find((r) => r.r === "new/repo")?.v).toBe(0);
  });

  // 9-oct-2026: GitHub started answering the App token with a FORBIDDEN partial
  // (node = null) for stargazers(last:N) on repos it does not own, so every
  // chunk came back empty, "all chunks failed" threw, and cold /r/ pages
  // rendered TELEMETRY LINK FAILED. The stub reproduces that exact payload
  // whenever the App asks for stargazers.
  it("survives the App token being FORBIDDEN on stargazers", async () => {
    vi.doMock("@/lib/ghauth", () => ({
      pickAuth: async () => ({ token: "app-token", source: "app" }),
      noteRateLimit: () => {},
      lowFuel: () => false,
    }));
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: { headers: Record<string, string>; body?: string }) =>
          init.headers.Authorization === "Bearer app-token" && (init.body ?? "").includes("stargazers")
            ? json(200, { data: { r0: null, r1: null }, errors: [{ type: "FORBIDDEN" }, { type: "FORBIDDEN" }] })
            : json(200, { data: { r0: node("big/repo", 61000), r1: node("new/repo", 0) } }),
        ),
      );
      const { neighborsVelocity } = await import("@/lib/github");
      const out = await neighborsVelocity(["big/repo", "new/repo"], Date.parse("2026-10-09T07:00:00Z"));
      expect(out.map((r) => r.r).sort()).toEqual(["big/repo", "new/repo"]);
      // unmeasurable stays unknown, never a measured-looking zero
      expect(out.find((r) => r.r === "big/repo")?.v).toBeNull();
    } finally {
      vi.doUnmock("@/lib/ghauth");
    }
  });
});

describe("graphql partial errors", () => {
  it("returns the good data next to a NOT_FOUND alias instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(200, {
          data: { r0: node("big/repo", 61000), r1: null },
          errors: [{ type: "NOT_FOUND", path: ["r1"], message: "Could not resolve to a Repository with the name 'old/name'." }],
        }),
      ),
    );
    const { graphql } = await import("@/lib/github");
    const d = await graphql<Record<string, unknown>>("{ r0: repository(owner:\"big\",name:\"repo\"){ id } }");
    expect(d.r0).toBeTruthy();
    expect(d.r1).toBeNull();
  });

  it("throws when there is no data at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { data: null, errors: [{ type: "FORBIDDEN" }] })));
    const { graphql } = await import("@/lib/github");
    await expect(graphql("{ x }")).rejects.toThrow(/GraphQL/);
  });
});

// The dossier's own aliased query as GitHub answers it on a bad day: a timeout
// NESTED under `repository` nulls it while the three sibling searches answer.
const NESTED = {
  data: { opened: { issueCount: 41 }, closed: { issueCount: 37 }, merged: { issueCount: 12 }, repository: null },
  errors: [{ type: "TIMEOUT", path: ["repository", "releases"], message: "Timeout on validation of query" }],
};
// One whole alias unanswered (a search that did not come back), the rest good.
const ONE_ALIAS = {
  data: {
    opened: null,
    closed: { issueCount: 37 },
    merged: null,
    repository: {
      issues: { totalCount: 230 },
      defaultBranchRef: { target: { history: { totalCount: 88 } } },
      releases: { nodes: [] },
      object: null,
    },
  },
  errors: [
    { type: "SERVICE_UNAVAILABLE", path: ["opened"], message: "search timed out" },
    { type: "SERVICE_UNAVAILABLE", path: ["merged"], message: "search timed out" },
  ],
};

describe("graphql partial errors: the collector's rule", () => {
  // The app kept ANY answer that had data. The dossier then published
  // "0 issues / 0 merged PRs" on /r/, /api/v1/dossier and the CLI whenever
  // GitHub degraded; the collector had stopped doing this on 2026-09-26.
  it("throws on an error nested inside a field, even when siblings answered", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, NESTED)));
    const { graphql, repoDossier } = await import("@/lib/github");
    await expect(graphql("{ x }")).rejects.toThrow(/Timeout/);
    await expect(repoDossier("a", "b")).rejects.toThrow(/GraphQL/);
  });

  it("reads an unanswered alias as unmeasured, never 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, ONE_ALIAS)));
    const { repoDossier } = await import("@/lib/github");
    const d = await repoDossier("a", "b");
    expect(d.issuesOpened30).toBeNull();
    expect(d.prsMerged30).toBeNull();
    expect(d.issuesClosed30).toBe(37);
    expect(d.openIssues).toBe(230);
    expect(d.commits30).toBe(88);
  });
});

describe("onlyWholeAliasesMissing: app and collector agree", () => {
  const CASES: [string, unknown, unknown][] = [
    ["nested error under a nulled field", NESTED.data, NESTED.errors],
    ["whole aliases missing, others answered", ONE_ALIAS.data, ONE_ALIAS.errors],
    ["NOT_FOUND alias next to a good one", { r0: { id: 1 }, r1: null }, [{ type: "NOT_FOUND", path: ["r1"] }]],
    ["every alias missing", { r0: null, r1: null }, [{ path: ["r0"] }, { path: ["r1"] }]],
    ["error without a path", { r0: { id: 1 }, r1: null }, [{ type: "FORBIDDEN" }]],
    ["error naming an alias that answered", { r0: { id: 1 } }, [{ path: ["r0"] }]],
    ["no data", null, [{ path: ["r0"] }]],
    ["no errors", { r0: { id: 1 } }, []],
  ];
  it.each(CASES)("%s", async (_, data, errors) => {
    const { onlyWholeAliasesMissing } = await import("@/lib/github");
    expect(onlyWholeAliasesMissing(data, errors as { path?: unknown }[])).toBe(collectorRule(data, errors));
  });

  it("keeps exactly the whole-alias case", async () => {
    const { onlyWholeAliasesMissing } = await import("@/lib/github");
    const kept = CASES.filter(([, d, e]) => onlyWholeAliasesMissing(d, e as { path?: unknown }[])).map(([n]) => n);
    expect(kept).toEqual(["whole aliases missing, others answered", "NOT_FOUND alias next to a good one"]);
  });
});
