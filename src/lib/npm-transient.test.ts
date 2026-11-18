import { afterEach, describe, expect, it, vi } from "vitest";

// #42 (2026-11-10): the REAL USAGE chart lost its npm bars "depending on the
// hour". A failed npm call came back as null, indistinguishable from "no
// package", and the dossier built on it was cached for 15 minutes.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const RANGE = { downloads: [{ day: "2026-11-08", downloads: 939 }, { day: "2026-11-09", downloads: 1378 }] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("npm calls tell a failure from an absent package", () => {
  it("a 404 is an answer: null, no transient", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { error: "not found" })));
    const { npmDownloadsRange } = await import("@/lib/github");
    const onTransient = vi.fn();
    expect(await npmDownloadsRange("nope", onTransient)).toBeNull();
    expect(onTransient).not.toHaveBeenCalled();
  });

  it("a 429 is reported as transient at once, without hammering npm again", async () => {
    const f = vi.fn(async () => json(429, { error: "rate limited" }));
    vi.stubGlobal("fetch", f);
    const { npmDownloadsRange } = await import("@/lib/github");
    const onTransient = vi.fn();
    expect(await npmDownloadsRange("@santifer/career-ops", onTransient)).toBeNull();
    expect(onTransient).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a 5xx that persists is reported as transient after one retry", async () => {
    const f = vi.fn(async () => json(503, {}));
    vi.stubGlobal("fetch", f);
    const { npmDownloadsRange } = await import("@/lib/github");
    const onTransient = vi.fn();
    expect(await npmDownloadsRange("@santifer/career-ops", onTransient)).toBeNull();
    expect(onTransient).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("a blip that recovers on the retry returns the series, no transient", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (n++ === 0 ? json(503, {}) : json(200, RANGE))));
    const { npmDownloadsRange } = await import("@/lib/github");
    const onTransient = vi.fn();
    expect(await npmDownloadsRange("@santifer/career-ops", onTransient)).toEqual([
      { day: "2026-11-08", d: 939 },
      { day: "2026-11-09", d: 1378 },
    ]);
    expect(onTransient).not.toHaveBeenCalled();
  });

  it("a timeout counts as a failure, not as no package", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); }));
    const { npmDownloadsWindow } = await import("@/lib/github");
    const onTransient = vi.fn();
    expect(await npmDownloadsWindow("@santifer/career-ops", onTransient)).toBeNull();
    expect(onTransient).toHaveBeenCalledTimes(1);
  });
});

describe("the dossier cache never stores a partial dossier", () => {
  const dossier = { npmHistory: null } as never;

  it("partial: thrown (not stored), carrying the dossier for this reader", async () => {
    const { dossierForCache } = await import("@/lib/explorer");
    const err = await dossierForCache("career-ops-hq", "career-ops", async () => ({ dossier, partial: true })).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { data: unknown }).data).toBe(dossier);
  });

  it("whole: returned, so the cache stores it", async () => {
    const { dossierForCache } = await import("@/lib/explorer");
    await expect(dossierForCache("career-ops-hq", "career-ops", async () => ({ dossier, partial: false }))).resolves.toBe(dossier);
  });
});

describe("resolveNpmUsage end to end (the panel's real path)", () => {
  const POINT = { downloads: 21562, start: "2026-10-11", end: "2026-11-09" };
  // route each npm URL; the bare name is a fast 404 like in production
  const npmFetchStub = (rangeStatus: number, rangeBody: unknown = RANGE) =>
    vi.fn(async (url: string) => {
      if (!url.includes("%40santifer%2Fcareer-ops")) return json(404, { error: "not found" });
      if (url.includes("/downloads/point/last-month/")) return json(200, POINT);
      if (url.includes("/downloads/range/")) return json(rangeStatus, rangeBody);
      return json(404, {});
    });

  it("range failing twice: partial, so the dossier is never cached", async () => {
    vi.stubGlobal("fetch", npmFetchStub(503));
    const { resolveNpmUsage } = await import("@/lib/explorer");
    const r = await resolveNpmUsage("career-ops-hq", "career-ops", null);
    expect(r.npmPkg).toBe("@santifer/career-ops");
    expect(r.npmHistory).toBeNull();
    expect(r.npmTransient).toBe(true);
  });

  it("npm mid-reindex (200, a year of zeros next to a positive total): partial too", async () => {
    vi.stubGlobal("fetch", npmFetchStub(200, { downloads: [{ day: "2026-11-09", downloads: 0 }] }));
    const { resolveNpmUsage } = await import("@/lib/explorer");
    expect((await resolveNpmUsage("career-ops-hq", "career-ops", null)).npmTransient).toBe(true);
  });

  it("all answers in: whole, cacheable", async () => {
    vi.stubGlobal("fetch", npmFetchStub(200));
    const { resolveNpmUsage } = await import("@/lib/explorer");
    const r = await resolveNpmUsage("career-ops-hq", "career-ops", null);
    expect(r.npmHistory?.length).toBe(2);
    expect(r.npmTransient).toBe(false);
  });
});
