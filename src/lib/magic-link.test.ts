import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";

// An in-memory Blob with the semantics that matter here: get returns what is
// stored, del is idempotent (no error when missing), and put with
// allowOverwrite:false throws when the key exists. Every call yields once, so
// two redeemers interleave the way two taps of the button do.
const store = new Map<string, string>();
const tick = () => new Promise((r) => setTimeout(r, 0));
vi.mock("@vercel/blob", () => ({
  get: async (key: string) => {
    await tick();
    const v = store.get(key);
    return v == null ? null : { statusCode: 200, stream: new Response(v).body };
  },
  put: async (key: string, body: string, opts: { allowOverwrite?: boolean }) => {
    await tick();
    if (!opts.allowOverwrite && store.has(key)) throw new Error("This blob already exists");
    store.set(key, body);
    return { pathname: key };
  },
  del: async (keys: string | string[]) => {
    await tick();
    for (const k of [keys].flat()) store.delete(k);
  },
}));

const { grantIsLive, magicKey, redeemMagic, TOKEN_RE } = await import("./magic-link");

const mint = (minutes = 30) => {
  const m = randomBytes(32).toString("base64url");
  store.set(magicKey(m), JSON.stringify({ exp: new Date(Date.now() + minutes * 60e3).toISOString(), vault: true, createdAt: "" }));
  return m;
};

beforeEach(() => {
  store.clear();
  process.env.BLOB_READ_WRITE_TOKEN = "test";
});

describe("redeemMagic", () => {
  it("two simultaneous taps get ONE grant (both read it before either deleted it; the review caught two)", async () => {
    const m = mint();
    const got = await Promise.all([redeemMagic(m), redeemMagic(m)]);
    expect(got.filter(Boolean)).toHaveLength(1);
  });

  it("a second tap after the first finds nothing, and the Blob is left clean", async () => {
    const m = mint();
    expect(await redeemMagic(m)).not.toBeNull();
    expect(await redeemMagic(m)).toBeNull();
    expect(store.size).toBe(0);
  });

  it("an expired link gives nothing, and is burned too", async () => {
    const m = mint(-1);
    expect(await redeemMagic(m)).toBeNull();
    expect(store.has(magicKey(m))).toBe(false);
  });

  it("a malformed or unknown token never reaches a usable grant", async () => {
    expect(await redeemMagic("../../etc")).toBeNull();
    expect(await redeemMagic(randomBytes(32).toString("base64url"))).toBeNull();
  });
});

describe("magic link format", () => {
  it("a minted token matches TOKEN_RE; injection-shaped strings do not", () => {
    expect(TOKEN_RE.test(randomBytes(32).toString("base64url"))).toBe(true);
    for (const bad of ["", "abc", "x".repeat(44), "a\"><script>".padEnd(43, "a"), "../".padEnd(43, "a")]) {
      expect(TOKEN_RE.test(bad), bad).toBe(false);
    }
  });
  it("stores only a hash of the token", () => {
    const m = randomBytes(32).toString("base64url");
    expect(magicKey(m)).toBe(`god/magic/${createHash("sha256").update(m).digest("hex")}.json`);
    expect(magicKey(m)).not.toContain(m);
  });
  it("an expired or malformed grant is dead", () => {
    const now = Date.parse("2026-10-20T15:00:00Z");
    expect(grantIsLive({ exp: "2026-10-20T15:30:00Z", vault: true, createdAt: "" }, now)).toBe(true);
    expect(grantIsLive({ exp: "2026-10-20T14:59:59Z", vault: true, createdAt: "" }, now)).toBe(false);
    expect(grantIsLive(null, now)).toBe(false);
  });
});
