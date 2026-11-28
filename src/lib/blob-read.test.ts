import { MockAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A failed read is not absence. Every render-path reader used to fold a 5xx
// into `null`, and `null` is what each surface reads as "locked" or "not
// tracked". The cache then held it (15 min for vitals and PR flow, 5 min for
// the vault, 1 h for a rank shard, 6 h for a curve): a paying tenant saw the
// upsell on the Vital Signs they bought, and TrafficPanel answered a valid key
// with "VAULT KEY REJECTED" and a FORGET KEY button.
//
// These tests drive the REAL @vercel/blob client against a stubbed store
// (undici MockAgent, which is what its fetch goes through), answering 503 the
// way the store does in an outage.

// unstable_cache's contract, as Next implements it: a resolved value is
// stored, a rejection is not (next/dist/server/web/spec-extension/unstable-cache.js).
const store = new Map<string, unknown>();
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => Promise<unknown>, keyParts: string[] = []) =>
    async (...args: unknown[]) => {
      const k = JSON.stringify([keyParts, args]);
      if (store.has(k)) return store.get(k);
      const v = await fn(...args);
      store.set(k, v);
      return v;
    },
}));

// The curve's GitHub calls: a 50k-star repo with no stargazer listing, so the
// daily record from rank-history is the only exact source it has.
vi.mock("@/lib/github", () => ({
  repoBasic: async () => ({ r: "acme/big", s: 50_000, created: "2020-01-01T00:00:00Z", id: 1 }),
  stargazerPageFirst: async () => null,
  lowFuel: () => true,
}));

const ORIGIN = "https://teststore.private.blob.vercel-storage.com";
let agent: MockAgent;
let previous: Dispatcher;

function answer(prefix: string, status: number, body: unknown = "", times = 1) {
  agent
    .get(ORIGIN)
    .intercept({ path: (p) => p.startsWith(prefix), method: "GET" })
    .reply(status, typeof body === "string" ? body : JSON.stringify(body))
    .times(times);
}

const VITALS = { activity: { compositeRank: 3 }, verdict: "ALIVE" };

beforeEach(() => {
  vi.resetModules();
  store.clear();
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore_secret";
  process.env.VAULT_KEY = "master-key";
  previous = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // ossinsight (the curve's archive source) is down too
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
});
afterEach(async () => {
  setGlobalDispatcher(previous);
  await agent.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.VAULT_KEY;
});

describe("vitals: a 503 is never 'locked'", () => {
  it("rejects on a 503, is not cached, and reads the data once the store answers", async () => {
    const { loadVitals } = await import("./vitals");
    const { settle } = await import("./blob-read");
    const { vitalsReading } = await import("./vitals-reading");
    answer("/vitals/acme--paid.json", 503);
    const read = await settle(loadVitals("acme", "paid"), "vitals");
    expect(read.state).toBe("failed");
    // whatever the entitlement, a failed read is never the upsell
    expect(vitalsReading(read, true).state).toBe("failed");
    expect(vitalsReading(read, false).state).toBe("failed");

    answer("/vitals/acme--paid.json", 200, VITALS);
    const again = await settle(loadVitals("acme", "paid"), "vitals");
    expect(again).toEqual({ state: "data", value: VITALS });
  });

  it("a 404 is absence: pending for an entitled repo, locked only for the rest", async () => {
    const { loadVitals } = await import("./vitals");
    const { settle } = await import("./blob-read");
    const { vitalsReading } = await import("./vitals-reading");
    answer("/vitals/acme--new.json", 404);
    const read = await settle(loadVitals("acme", "new"), "vitals");
    expect(read.state).toBe("absent");
    expect(vitalsReading(read, true).state).toBe("pending");
    expect(vitalsReading(read, false).state).toBe("locked");
  });

  it("a store that never answers is a failure after the timeout, not a hang", async () => {
    const { readPrivateJson, BlobReadError } = await import("./blob-read");
    agent
      .get(ORIGIN)
      .intercept({ path: (p) => p.startsWith("/vitals/acme--slow.json"), method: "GET" })
      .reply(200, JSON.stringify(VITALS))
      .delay(2_000);
    await expect(
      readPrivateJson("vitals/acme--slow.json", process.env.BLOB_READ_WRITE_TOKEN!, { timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(BlobReadError);
  });
});

describe("PR flow: a 503 is never 'not tracked'", () => {
  it("rejects on a 503 and is not cached", async () => {
    const { loadPrFlow } = await import("./prflow");
    const { settle } = await import("./blob-read");
    answer("/prflow/acme--paid.json", 503);
    expect((await settle(loadPrFlow("acme", "paid"), "prflow")).state).toBe("failed");
    const flow = { repo: "acme/paid", days: [["2026-10-18", 1, 1, 0, 3, 2]] };
    answer("/prflow/acme--paid.json", 200, flow);
    expect(await loadPrFlow("acme", "paid")).toEqual(flow);
  });
});

describe("Traffic Vault: a 503 is never 'VAULT KEY REJECTED'", () => {
  it("/api/traffic answers 503 (not 200 with no vault, not 403) to a valid key", async () => {
    const { GET } = await import("@/app/api/traffic/route");
    const { NextRequest } = await import("next/server");
    answer("/traffic/acme--paid.json", 503);
    const res = await GET(new NextRequest("https://warpchart.test/api/traffic?repo=acme/paid&key=master-key"));
    expect(res.status).toBe(503);
    const { vaultFailure } = await import("./vault-status");
    expect(vaultFailure(res.status)).toBe("unavailable");
  });

  it("only a refusal reads as a rejected key", async () => {
    const { vaultFailure } = await import("./vault-status");
    expect(vaultFailure(403)).toBe("denied");
    expect(vaultFailure(400)).toBe("denied");
    expect(vaultFailure(500)).toBe("unavailable");
    expect(vaultFailure(502)).toBe("unavailable");
    expect(vaultFailure(503)).toBe("unavailable");
    expect(vaultFailure(200)).toBeNull();
  });
});

describe("rank history: a failed shard is not 'never ranked'", () => {
  const series = {
    dates: ["2026-10-17", "2026-10-18"],
    series: { "acme/big": [["2026-10-17", 900, 49_000], ["2026-10-18", 899, 49_400]] },
  };

  it("rejects on a 503 (the hour-long shard cache stores nothing), then reads the record", async () => {
    const { repoRankTrajectory } = await import("./rank-history");
    answer("/route-history/shard-", 503);
    await expect(repoRankTrajectory("acme/big")).rejects.toThrow(/503/);
    answer("/route-history/shard-", 200, series);
    expect((await repoRankTrajectory("acme/big")).map((p) => p.rank)).toEqual([900, 899]);
  });

  it("the curve built during the outage is not cached for 6 h", async () => {
    const { cachedSampleCurve } = await import("./curve");
    answer("/route-history/shard-", 503);
    const during = await cachedSampleCurve("acme", "big");
    expect(during.degraded).toBe(true);
    expect(during.exactFrom ?? null).toBeNull();

    answer("/route-history/shard-", 200, series);
    const after = await cachedSampleCurve("acme", "big");
    // the daily record is spliced in as soon as the store answers
    expect(after.exactFrom ?? null).not.toBeNull();
  });
});
