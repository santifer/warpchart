// Mints a one-time magic link that unlocks god mode on whatever device opens
// it (the owner's phone, a second laptop), so the master key never has to be
// copied between devices. Redeemed by POST /unlock (src/lib/magic-link.ts):
// one use, then deleted; dead after --ttl minutes even if unused. Only the
// SHA-256 of the token is stored, so the Blob never holds a usable link.
//
// GUEST link (--guest <name> --repo owner/name): redeeming it mints a guest key
// scoped to that repo (src/lib/guest-keys.ts) instead of the master keys; the
// person sees exactly the owner's view on that repo's page, and nothing on any
// other. Revoke with scripts/god-guests.mjs.
//
// Usage: BLOB_READ_WRITE_TOKEN=... node scripts/god-magic-link.mjs [--no-vault] [--ttl 30] [--base https://warpchart.dev] [--guest vince --repo career-ops-hq/career-ops]
import { randomBytes } from "node:crypto";
import { put, list, del } from "@vercel/blob";
import { magicKey, MAGIC_PREFIX, MAX_TTL_MIN, TOKEN_RE } from "./magic-key.mjs";

const args = process.argv.slice(2);
// an unknown or "--flag=value" argument must stop the script: "--guest=vince"
// used to parse as no guest and mint a MASTER link
const KNOWN = new Set(["--no-vault", "--ttl", "--base", "--guest", "--repo"]);
for (let i = 0; i < args.length; i++) {
  if (!KNOWN.has(args[i])) {
    console.error(`unknown argument: ${args[i]}`);
    process.exit(1);
  }
  if (args[i] !== "--no-vault") i++;
}
const arg = (name, def) => {
  if (!args.includes(name)) return def;
  const v = args[args.indexOf(name) + 1];
  if (!v || v.startsWith("--")) {
    console.error(`${name} needs a value`);
    process.exit(1);
  }
  return v;
};
const ttl = Number(arg("--ttl", "30"));
const base = arg("--base", "https://warpchart.dev").replace(/\/$/, "");
const vault = !args.includes("--no-vault");
const guestName = arg("--guest", null);
const guestRepo = arg("--repo", null);
if (!!guestName !== !!guestRepo || (guestRepo && !/^[\w.-]+\/[\w.-]+$/.test(guestRepo))) {
  console.error("--guest <name> and --repo owner/name go together");
  process.exit(1);
}
const guest = guestName ? { name: guestName, repos: [guestRepo] } : undefined;
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error("needs BLOB_READ_WRITE_TOKEN");
  process.exit(1);
}
if (!(ttl > 0 && ttl <= MAX_TTL_MIN)) {
  console.error(`--ttl must be 1..${MAX_TTL_MIN} minutes`);
  process.exit(1);
}
if (!/^https:\/\//.test(base) && !/^http:\/\/localhost(:\d+)?$/.test(base)) {
  console.error("--base must be https:// (or http://localhost for a local test)");
  process.exit(1);
}

// sweep grants nobody redeemed (older than the longest TTL): harmless hashes, but they pile up
const { blobs } = await list({ prefix: MAGIC_PREFIX, token });
const stale = blobs.filter((b) => Date.now() - new Date(b.uploadedAt).getTime() > MAX_TTL_MIN * 60e3 * 2).map((b) => b.url);
if (stale.length) await del(stale, { token });

const m = randomBytes(32).toString("base64url");
if (!TOKEN_RE.test(m)) throw new Error("token format drifted from TOKEN_RE");
const key = magicKey(m);
const now = Date.now();
await put(key, JSON.stringify({ exp: new Date(now + ttl * 60e3).toISOString(), vault, createdAt: new Date(now).toISOString(), guest }), {
  access: "private",
  token,
  addRandomSuffix: false,
  allowOverwrite: false,
  contentType: "application/json",
});
console.log(`${base}/unlock?m=${m}`);
console.error(`one use · expires ${new Date(now + ttl * 60e3).toISOString()} · ${vault ? "rank + vault" : "rank only"}${guest ? ` · GUEST ${guest.name} on ${guest.repos.join(", ")}` : " · MASTER keys"}`);
