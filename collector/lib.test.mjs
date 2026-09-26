import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The collector's boundary with GitHub. Every fixture is the SHAPE of a real
// answer that once turned into a wrong number: an empty edges list for a repo
// with 61k stars, a 200 that carries a FORBIDDEN error, a 403 with quota left,
// a batch where one renamed repo comes back as NOT_FOUND next to good data.

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const ENV_KEYS = ["GH_TOKEN", "GH_TOKEN_FALLBACKS", "GITHUB_TOKEN"];
let savedEnv;
let calls;

// lib.mjs keeps the working token index in module state (sticky on purpose),
// so every test gets a fresh copy of the module and a fresh fake network.
async function freshLib(respond) {
  vi.resetModules();
  process.env.GH_TOKEN = "tokA,tokB";
  delete process.env.GH_TOKEN_FALLBACKS;
  delete process.env.GITHUB_TOKEN;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const call = { url: String(url), auth: init?.headers?.Authorization, body: init?.body ? JSON.parse(init.body) : null };
      calls.push(call);
      return respond(calls.length, call);
    }),
  );
  return import("./lib.mjs");
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const node = (nameWithOwner, stargazerCount, edges = []) => ({
  nameWithOwner,
  stargazerCount,
  description: null,
  primaryLanguage: null,
  stargazers: { edges },
});

describe("reposVelocity: unknown is not zero", () => {
  const now = new Date("2026-09-26T12:00:00Z");

  it("reads an empty stargazer window on a starred repo as null, not 0 stars/day", async () => {
    const lib = await freshLib(() =>
      json(200, {
        data: {
          r0: node("big/repo", 61000, []), // GitHub stopped listing foreign stargazers
          r1: node("new/repo", 0, []), // genuinely no stars: a measured zero
          r2: node("live/repo", 500, [
            { starredAt: "2026-09-25T12:00:00Z" },
            { starredAt: "2026-09-26T00:00:00Z" },
          ]),
        },
      }),
    );
    const out = await lib.reposVelocity(["big/repo", "new/repo", "live/repo"], now);
    expect(out.find((r) => r.r === "big/repo").v).toBeNull();
    expect(out.find((r) => r.r === "new/repo").v).toBe(0);
    expect(out.find((r) => r.r === "live/repo").v).toBe(2); // 2 stars over 1 day
  });

  it("keeps the rest of a batch when one renamed repo comes back NOT_FOUND", async () => {
    const lib = await freshLib(() =>
      json(200, {
        data: { r0: node("big/repo", 61000, []), r1: null },
        errors: [{ type: "NOT_FOUND", path: ["r1"], message: "Could not resolve to a Repository" }],
      }),
    );
    const out = await lib.reposVelocity(["big/repo", "old/name"], now);
    expect(out.map((r) => r.r)).toEqual(["big/repo"]);
  });
});

describe("graphql: partial answers and permission failover", () => {
  it("still throws when a single-repo query resolves to nothing", async () => {
    const lib = await freshLib(() =>
      json(200, { data: { repository: null }, errors: [{ type: "NOT_FOUND", message: "nope" }] }),
    );
    await expect(lib.graphql("query { repository(owner:\"a\",name:\"b\"){ id } }")).rejects.toThrow(/NOT_FOUND/);
  });

  // Review catch, 2026-09-26: an error NESTED inside a field nulls that field
  // (here the repository) while sibling searches still answer. Accepting that
  // as partial data published commits30=0 as a measurement. It must throw, so
  // the caller retries or keeps its previous value.
  it("still throws when the error is nested inside a field, even if siblings answered", async () => {
    const lib = await freshLib(() =>
      json(200, {
        data: { repository: null, qc: { issueCount: 12 }, qm: { issueCount: 3 } },
        errors: [{ type: "TIMEOUT", path: ["repository", "releases"], message: "timedout" }],
      }),
    );
    await expect(lib.graphql("{ repository { releases } qc: search qm: search }")).rejects.toThrow(/timedout/);
  });

  it("keeps the other aliases when one alias is FORBIDDEN for every token (e.g. SAML)", async () => {
    const lib = await freshLib(() =>
      json(200, {
        data: { r0: node("open/repo", 100, []), r1: null },
        errors: [{ type: "FORBIDDEN", path: ["r1"], message: "SAML enforcement" }],
      }),
    );
    const out = await lib.reposVelocity(["open/repo", "saml/repo"], new Date("2026-09-26T12:00:00Z"));
    expect(out.map((r) => r.r)).toEqual(["open/repo"]);
    expect(calls).toHaveLength(2); // it tried the other token first
  });

  it("fails over on a 200 that carries FORBIDDEN, and sticks to the token that works", async () => {
    const lib = await freshLib((n, call) =>
      call.auth === "Bearer tokA"
        ? json(200, { data: null, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }] })
        : json(200, { data: { x: n } }),
    );
    expect(await lib.graphql("{ x }")).toEqual({ x: 2 });
    await lib.graphql("{ x }");
    expect(calls.map((c) => c.auth)).toEqual(["Bearer tokA", "Bearer tokB", "Bearer tokB"]);
  });
});

describe("ghFetch: a 403 with quota left is a permission denial", () => {
  it("fails over to the next token instead of sleeping on it", async () => {
    const lib = await freshLib((n) =>
      n === 1
        ? json(403, { message: "Resource not accessible by personal access token" }, { "x-ratelimit-remaining": "3718" })
        : json(200, { ok: true }),
    );
    const started = Date.now();
    expect(await lib.ghFetch("/repos/career-ops-hq/career-ops/commits")).toEqual({ ok: true });
    expect(calls.map((c) => c.auth)).toEqual(["Bearer tokA", "Bearer tokB"]);
    expect(Date.now() - started).toBeLessThan(1500); // no rate-limit sleep
  });

  it("throws once every token in the pool has been refused", async () => {
    const lib = await freshLib(() =>
      json(403, { message: "denied" }, { "x-ratelimit-remaining": "3718" }),
    );
    await expect(lib.ghFetch("/repos/x/y/commits")).rejects.toThrow(/every token in the pool/);
  });
});
