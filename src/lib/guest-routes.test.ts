// The gated routes, end to end with an in-memory Blob: a guest key opens its
// own repo and nothing else, a forged key never reaches the Blob, a Blob that
// throws locks the guest out, and the guest unlock never carries a master key.
// A route that forgot an `await` (a Promise is truthy) would let everyone in:
// these tests are what catch it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
let blobDown = false;
let reads = 0;
vi.mock("@vercel/blob", () => ({
  get: async (key: string) => {
    reads++;
    if (blobDown) throw new Error("503");
    const v = store.get(key);
    return v == null ? null : { statusCode: 200, stream: new Response(v).body };
  },
  put: async (key: string, body: string, opts: { allowOverwrite?: boolean }) => {
    if (!opts.allowOverwrite && store.has(key)) throw new Error("exists");
    store.set(key, body);
  },
  del: async (keys: string | string[]) => {
    for (const k of [keys].flat()) store.delete(k);
  },
}));
vi.mock("@/lib/rank-history", () => ({ repoRankTrajectory: async () => [{ t: 1, rank: 1 }] }));
vi.mock("@/lib/traffic", () => ({ loadTrafficVault: async () => ({ days: [] }) }));
vi.mock("@/lib/history", () => ({ findTenant: () => null }));

process.env.WARPCHART_GOD_KEY = "god-master-for-tests";
process.env.VAULT_KEY = "vault-master-for-tests";
process.env.BLOB_READ_WRITE_TOKEN = "t";
const { mintGuest } = await import("./guest-keys");
const rank = await import("@/app/api/v1/rank-history/route");
const traffic = await import("@/app/api/traffic/route");
const unlock = await import("@/app/unlock/route");
const { magicKey } = await import("./magic-link");
const { NextRequest } = await import("next/server");

const rankGet = (repo: string, k: string) =>
  rank.GET(new Request(`https://w.dev/api/v1/rank-history?repo=${encodeURIComponent(repo)}&k=${encodeURIComponent(k)}`));
const trafficGet = (repo: string, key: string) =>
  traffic.GET(new NextRequest(`https://w.dev/api/traffic?repo=${encodeURIComponent(repo)}&key=${encodeURIComponent(key)}`));

let vince = "";
beforeEach(async () => {
  store.clear();
  blobDown = false;
  vince = (await mintGuest({ name: "vince", repos: ["career-ops-hq/career-ops"], vault: true }))!;
  reads = 0;
});

describe("a guest key on the gated routes", () => {
  it("opens rank history and the vault of its own repo", async () => {
    expect((await rankGet("career-ops-hq/career-ops", vince)).status).toBe(200);
    expect((await trafficGet("career-ops-hq/career-ops", vince)).status).toBe(200);
  });

  it("is refused on any other repo (the rival included)", async () => {
    expect((await rankGet("ai-job-search-dev/ai-job-search", vince)).status).toBe(403);
    expect((await trafficGet("facebook/react", vince)).status).toBe(403);
  });

  it("without the vault in its grant, the vault stays shut", async () => {
    const noVault = (await mintGuest({ name: "x", repos: ["career-ops-hq/career-ops"], vault: false }))!;
    expect((await rankGet("career-ops-hq/career-ops", noVault)).status).toBe(200);
    expect((await trafficGet("career-ops-hq/career-ops", noVault)).status).toBe(403);
  });

  it("a revoked key (its file deleted) is refused on the next request", async () => {
    store.clear();
    expect((await rankGet("career-ops-hq/career-ops", vince)).status).toBe(403);
  });

  it("a Blob that throws locks the guest out, never lets them in", async () => {
    blobDown = true;
    expect((await rankGet("career-ops-hq/career-ops", vince)).status).toBe(403);
  });

  it("a forged key is refused without a single Blob read", async () => {
    const forged = `${vince.split(".")[0]}.${"A".repeat(22)}`;
    expect((await rankGet("career-ops-hq/career-ops", forged)).status).toBe(403);
    expect(reads).toBe(0);
  });

  it("the master keys still work as before", async () => {
    expect((await rankGet("facebook/react", "god-master-for-tests")).status).toBe(200);
    expect((await trafficGet("facebook/react", "vault-master-for-tests")).status).toBe(200);
  });
});

describe("redeeming a guest link", () => {
  it("parks a fresh guest key, never a master key, and only where no key is held", async () => {
    const m = "a".repeat(43);
    store.set(magicKey(m), JSON.stringify({ exp: new Date(Date.now() + 6e5).toISOString(), vault: true, createdAt: "", guest: { name: "vince", repos: ["career-ops-hq/career-ops"] } }));
    const form = new FormData();
    form.set("m", m);
    const html = await (await unlock.POST(new Request("https://w.dev/unlock", { method: "POST", body: form }))).text();
    expect(html).not.toContain("god-master-for-tests");
    expect(html).not.toContain("vault-master-for-tests");
    expect(html).toMatch(/if\(!localStorage\.getItem\("wc_god"\)\)localStorage\.setItem\("wc_god","[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}"\)/);
    expect(html).toContain("UNLOCKED · CAREER-OPS-HQ/CAREER-OPS");
  });
});
