// Shared by scripts/god-magic-link.mjs (mints) and src/lib/magic-link.ts
// (redeems), so the stored key of a token can never drift between the two.
import { createHash } from "node:crypto";

// 32 random bytes in base64url = 43 chars; anything else is not ours
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const MAGIC_PREFIX = "god/magic/";
export const magicKey = (token) => `${MAGIC_PREFIX}${createHash("sha256").update(token).digest("hex")}.json`;
// a second file that only ONE redeemer can create (put with allowOverwrite:false)
export const claimKey = (token) => magicKey(token).replace(/\.json$/, ".used");
export const MAX_TTL_MIN = 120;
