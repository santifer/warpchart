// The app's read-modify-write writers against a stubbed Blob. The incident: a
// read that fails with a 503 (not a 404) was flattened to "empty", and the
// write that followed replaced the stored map with one request's worth. Each
// case stubs that 503 and asserts no put is issued.
import { describe, it, expect, vi, beforeEach } from "vitest";

const blob = vi.hoisted(() => {
  class BlobError extends Error {}
  class BlobPreconditionFailedError extends BlobError {}
  return {
    store: new Map<string, unknown>(),
    fail: new Set<string>(),
    BlobError,
    BlobPreconditionFailedError,
    get: vi.fn(),
    put: vi.fn(),
  };
});

vi.mock("@vercel/blob", () => ({
  BlobError: blob.BlobError,
  BlobNotFoundError: class extends blob.BlobError {},
  BlobPreconditionFailedError: blob.BlobPreconditionFailedError,
  get: blob.get,
  put: blob.put,
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock("@/lib/badges", () => ({
  allActiveBadges: () => [{ r: "new/repo", key: "top-1k" }],
}));

beforeEach(() => {
  blob.store.clear();
  blob.fail.clear();
  blob.get.mockReset().mockImplementation(async (key: string) => {
    // the real get(): null on 404, a BlobError on anything else
    if (blob.fail.has(key)) throw new blob.BlobError("Failed to fetch blob: 503 Service Unavailable");
    if (!blob.store.has(key)) return null;
    return {
      statusCode: 200,
      stream: new Response(JSON.stringify(blob.store.get(key))).body,
      headers: new Headers(),
      blob: { pathname: key, etag: `"etag-${key}"` },
    };
  });
  blob.put.mockReset().mockResolvedValue({});
  process.env.BLOB_READ_WRITE_TOKEN = "stub";
  process.env.CRON_SECRET = "cron";
  process.env.VAULT_KEY = "master";
});

const putsTo = (key: string) => blob.put.mock.calls.filter(([k]) => k === key);

describe("earned badges (cron/badges)", () => {
  const KEY = "badges-earned.json";
  const cron = async () => {
    const { GET } = await import("@/app/api/cron/badges/route");
    return GET(new Request("https://x.test/api/cron/badges", { headers: { authorization: "Bearer cron" } }));
  };

  it("a 503 on the ledger writes nothing (it used to replace every earned badge)", async () => {
    blob.store.set(KEY, { "old/repo": { "top-1k": "2026-01-01" } });
    blob.fail.add(KEY);
    const res = await cron();
    expect(putsTo(KEY)).toEqual([]);
    expect(res.status).toBe(503);
  });

  it("adds the new badge and keeps every stored one, with a conditional write", async () => {
    blob.store.set(KEY, { "old/repo": { "top-1k": "2026-01-01" } });
    await cron();
    const [[, body, opts]] = putsTo(KEY);
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(["new/repo", "old/repo"]);
    expect(opts.ifMatch).toBe(`"etag-${KEY}"`);
  });
});

describe("embed sightings", () => {
  const KEY = "embeds/seen.json";

  it("a 503 on the seen map writes nothing (it used to wipe it to one entry)", async () => {
    blob.store.set(KEY, { "a/b": { at: "2026-01-01", surface: "chart" } });
    blob.fail.add(KEY);
    const { noteEmbedHit } = await import("./embed-track");
    const status = await noteEmbedHit("github-camo (abc)", "c/d", "chart");
    expect(putsTo(KEY)).toEqual([]);
    expect(status).toMatch(/^not-written/);
  });

  it("the dashboard answers a 503 with an error, not an empty list", async () => {
    blob.store.set(KEY, { "a/b": { at: "2026-01-01", surface: "chart" } });
    blob.fail.add(KEY);
    const { GET } = await import("@/app/api/embeds/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest("https://x.test/api/embeds?key=master&forget=a/b"));
    expect(putsTo(KEY)).toEqual([]);
    expect(res.status).toBe(503);
  });

  it("forget removes exactly the one entry", async () => {
    blob.store.set(KEY, { "a/b": { at: "2026-01-01", surface: "chart" }, "c/d": { at: "2026-01-02", surface: "badge" } });
    const { GET } = await import("@/app/api/embeds/route");
    const { NextRequest } = await import("next/server");
    await GET(new NextRequest("https://x.test/api/embeds?key=master&forget=a/b"));
    const [[, body]] = putsTo(KEY);
    expect(Object.keys(JSON.parse(body))).toEqual(["c/d"]);
  });
});

describe("alert watermarks", () => {
  const KEY = "alerts/sent.json";

  it("a 503 is an error, not an empty map (an empty map re-sends the last 24 h)", async () => {
    blob.fail.add(KEY);
    const { readAlertsSent } = await import("./alerts-store");
    await expect(readAlertsSent()).rejects.toThrow();
  });

  it("a save never drops a repo or moves its watermark back", async () => {
    blob.store.set(KEY, { "a/b": "2026-10-02T00:00:00Z", "c/d": "2026-10-01T00:00:00Z" });
    const { saveAlertsSent } = await import("./alerts-store");
    await saveAlertsSent({ "a/b": "2026-10-01T00:00:00Z", "e/f": "2026-10-03T00:00:00Z" });
    const [[, body]] = putsTo(KEY);
    expect(JSON.parse(body)).toEqual({
      "a/b": "2026-10-02T00:00:00Z",
      "c/d": "2026-10-01T00:00:00Z",
      "e/f": "2026-10-03T00:00:00Z",
    });
  });
});

describe("updateJson", () => {
  it("retries a lost race on a fresh read, then writes the merge of the newer value", async () => {
    const { updateJson } = await import("./blob");
    blob.store.set("k.json", { n: 1 });
    blob.put.mockImplementationOnce(async () => {
      blob.store.set("k.json", { n: 5 }); // another writer landed first
      throw new blob.BlobPreconditionFailedError("etag mismatch");
    });
    const { value } = await updateJson<{ n: number }>("k.json", (s) => ({ n: (s?.n ?? 0) + 1 }));
    expect(value).toEqual({ n: 6 });
    expect(blob.get.mock.calls.every(([, o]) => o.useCache === false)).toBe(true);
  });
});
