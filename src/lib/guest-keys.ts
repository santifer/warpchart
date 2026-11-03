// GUEST KEYS: god mode for one person, on the repos the owner picked, without
// handing out the master keys. A guest key is minted at the moment a guest
// magic link is redeemed (POST /unlock), parked in that browser's localStorage
// like the master key, and works only for the repos in its scope: on any other
// repo the private panels stay locked (403), exactly as with no key.
//
// Only the SHA-256 of a guest key is stored (god/guests/{sha256}.json), so the
// Blob never holds a usable key. Revoking one = deleting its file
// (scripts/god-guests.mjs). Read with useCache:false so a revocation bites on
// the next request, not when a CDN copy expires.
//
// A guest key is SIGNED: `{r}.{sig}`, r = 16 random bytes, sig = HMAC of r
// under the god master key, so a made-up key is refused before any Blob read
// (a spam script cannot run up the Blob bill), and the dot tells the client
// panels it holds a guest key. Rotating WARPCHART_GOD_KEY kills every guest key.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { get, put } from "@vercel/blob";
import { canonicalRepo } from "./aliases";
import { GUEST_PREFIX, guestKeyPath } from "../../scripts/magic-key.mjs";

export interface GuestGrant {
  name: string; // who it is for, for listing and revoking
  repos: string[]; // canonical owner/name, lowercased
  vault: boolean; // also the Traffic Vault of those repos
  createdAt: string;
}

export { GUEST_PREFIX };

export const GUEST_KEY_RE = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/;
const VALID_REPO = /^[\w.-]+\/[\w.-]+$/;
const sign = (r: string, secret: string) =>
  createHmac("sha256", secret).update(`guest:${r}`).digest().subarray(0, 16).toString("base64url");

// null without the master key to sign with
export function newGuestKey(secret = process.env.WARPCHART_GOD_KEY ?? ""): string | null {
  if (!secret) return null;
  const r = randomBytes(16).toString("base64url");
  return `${r}.${sign(r, secret)}`;
}

// shape AND signature; false for anything else, without touching the Blob
export function guestKeySigned(k: string, secret = process.env.WARPCHART_GOD_KEY ?? ""): boolean {
  const m = GUEST_KEY_RE.exec(k ?? "");
  if (!m || !secret) return false;
  const want = Buffer.from(sign(m[1], secret));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got);
}

export const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");

// constant-time-ish compare for the master keys
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// is this guest grant valid for this repo (and, if asked, for its vault)?
export function grantCovers(g: Partial<GuestGrant> | null, repo: string, needVault = false): boolean {
  if (!g || !Array.isArray(g.repos)) return false;
  if (needVault && g.vault !== true) return false;
  return g.repos.includes(canonicalRepo(repo).toLowerCase());
}

// null on anything but a found, parseable grant: an unreadable Blob locks the
// guest out (a 403), never lets them in
async function readGrant(k: string): Promise<GuestGrant | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token || !guestKeySigned(k)) return null;
  try {
    const res = await get(guestKeyPath(hashKey(k)), { access: "private", token, useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return JSON.parse(await new Response(res.stream).text()) as GuestGrant;
  } catch {
    return null;
  }
}

// god-mode panels (rank history, velocity rank): the master key, or a guest
// key whose scope holds this repo
export async function authorizeGod(k: string, repo: string): Promise<boolean> {
  const master = process.env.WARPCHART_GOD_KEY ?? "";
  if (master && safeEqual(k, master)) return true;
  return grantCovers(await readGrant(k), repo);
}

// the Traffic Vault: a guest key whose scope holds this repo AND the vault
// (the master and tenant keys are checked by the caller, as before)
export async function authorizeGuestVault(k: string, repo: string): Promise<boolean> {
  return grantCovers(await readGrant(k), repo, true);
}

// writes a new guest grant and returns the key (the only time it exists in clear)
export async function mintGuest(g: Omit<GuestGrant, "createdAt">): Promise<string | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const k = newGuestKey();
  // the scope comes from the Blob (written by the owner's script): checked
  // again here, it ends up in the unlock page and in every scope check
  if (!token || !k || !g.repos?.length || !g.repos.every((r) => VALID_REPO.test(r))) return null;
  const grant: GuestGrant = {
    name: g.name,
    repos: g.repos.map((r) => canonicalRepo(r).toLowerCase()),
    vault: g.vault,
    createdAt: new Date().toISOString(),
  };
  try {
    await put(guestKeyPath(hashKey(k)), JSON.stringify(grant), {
      access: "private",
      token,
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/json",
    });
    return k;
  } catch {
    return null;
  }
}
