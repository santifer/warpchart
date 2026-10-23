// One-time magic links for the owner's god mode: a link that unlocks the
// browser that opens it, once, within a short window, without the owner having
// to copy the master key between devices. Minted by scripts/god-magic-link.mjs
// (needs only the Blob token), redeemed by POST /unlock.
//
// Only a HASH of the token is stored (god/magic/{sha256}.json), so the Blob
// listing never holds a usable link. One use, even under a race: two taps of
// the button can both read the grant before either deletes it (a Blob delete
// is idempotent), so the redeemer must first CREATE a claim file with
// allowOverwrite:false. Exactly one put succeeds; the other throws and gets
// nothing. Then the grant is deleted and the claim STAYS as a tombstone: a
// redeemer whose get answered late (it read the grant before the first one
// finished) must still find the claim taken. Deleting both re-opened the
// link once (the review reproduced two grants). The mint script sweeps old
// tombstones.
import { get, del, put } from "@vercel/blob";
import { TOKEN_RE, magicKey, claimKey } from "../../scripts/magic-key.mjs";

export { TOKEN_RE, magicKey };

export interface MagicGrant {
  exp: string; // ISO: after this the link is dead even if unused
  vault: boolean; // also unlock the Traffic Vault slot
  createdAt: string;
  // a GUEST link: redeeming it mints a guest key scoped to these repos
  // (src/lib/guest-keys.ts) instead of handing out the master keys
  guest?: { name: string; repos: string[] };
}

export function grantIsLive(g: Partial<MagicGrant> | null, now = Date.now()): g is MagicGrant {
  return !!g && typeof g.exp === "string" && Date.parse(g.exp) > now;
}

// null = unknown, already used or expired (the caller says the same thing for
// all three: which one it was is not the clicker's business)
export async function redeemMagic(token: string): Promise<MagicGrant | null> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken || !TOKEN_RE.test(token)) return null;
  const key = magicKey(token);
  let grant: Partial<MagicGrant> | null = null;
  try {
    const res = await get(key, { access: "private", token: blobToken, useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    grant = JSON.parse(await new Response(res.stream).text());
  } catch {
    return null;
  }
  // claim it atomically BEFORE handing anything out: only one redeemer can
  // create the claim file; a failed put (already claimed, or the Blob is down)
  // gives nothing
  try {
    await put(claimKey(token), "1", {
      access: "private",
      token: blobToken,
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "text/plain",
    });
  } catch {
    return null;
  }
  await del([key], { token: blobToken }).catch(() => {});
  return grantIsLive(grant) ? grant : null;
}
