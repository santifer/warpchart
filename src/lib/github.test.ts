import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
});

describe("graphql partial errors", () => {
  it("returns the good data next to a NOT_FOUND alias instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(200, { data: { r0: node("big/repo", 61000), r1: null }, errors: [{ type: "NOT_FOUND" }] }),
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
