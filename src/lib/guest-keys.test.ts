import { describe, expect, it } from "vitest";
import { grantCovers, guestKeySigned, hashKey, newGuestKey, safeEqual } from "./guest-keys";

// the grant a guest link for Vince writes (scripts/god-magic-link.mjs --guest vince --repo career-ops-hq/career-ops)
const vince = { name: "vince", repos: ["career-ops-hq/career-ops"], vault: true, createdAt: "2026-10-23T12:00:00Z" };

describe("grantCovers", () => {
  it("opens the repos in scope, under any name they carried (the pre-transfer name included)", () => {
    expect(grantCovers(vince, "career-ops-hq/career-ops")).toBe(true);
    expect(grantCovers(vince, "Career-Ops-HQ/Career-Ops")).toBe(true);
    expect(grantCovers(vince, "santifer/career-ops")).toBe(true); // alias resolves to the canonical name
  });

  it("never opens another repo: the rival, a tenant, the moat at large, a prefix", () => {
    expect(grantCovers(vince, "ai-job-search-dev/ai-job-search")).toBe(false);
    expect(grantCovers(vince, "career-ops-hq/career-ops2")).toBe(false);
    expect(grantCovers(vince, "career-ops-hq")).toBe(false);
    expect(grantCovers(vince, "facebook/react")).toBe(false);
  });

  it("the vault only when the grant says so", () => {
    expect(grantCovers(vince, "career-ops-hq/career-ops", true)).toBe(true);
    expect(grantCovers({ ...vince, vault: false }, "career-ops-hq/career-ops", true)).toBe(false);
  });

  it("a missing or malformed grant opens nothing", () => {
    expect(grantCovers(null, "career-ops-hq/career-ops")).toBe(false);
    expect(grantCovers({ name: "x" }, "career-ops-hq/career-ops")).toBe(false);
  });
});

describe("guest key material", () => {
  const secret = "god-master-for-tests";

  it("is {r}.{sig}, signed with the master key, and stored only hashed", () => {
    const k = newGuestKey(secret)!;
    expect(k).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/);
    expect(guestKeySigned(k, secret)).toBe(true);
    expect(hashKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey(k)).not.toContain(k.split(".")[0]);
  });

  it("a made-up, tampered or other-secret key fails the signature (no Blob read)", () => {
    const k = newGuestKey(secret)!;
    const [r, sig] = k.split(".");
    expect(guestKeySigned(`${r}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, secret)).toBe(false);
    expect(guestKeySigned(k, "another-secret")).toBe(false);
    expect(guestKeySigned("x".repeat(43), secret)).toBe(false);
    expect(guestKeySigned(k, "")).toBe(false);
    expect(newGuestKey("")).toBeNull();
  });

  it("safeEqual compares whole keys only", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
  });
});
