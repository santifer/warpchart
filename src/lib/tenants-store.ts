// The tenant registry (paying missions) lives in the PRIVATE Blob under the same
// data/ prefix the moat uses, so sync-from-blob mirrors it to disk at build time
// and loadTenants() reads that disk copy. The Polar webhook reads + writes it
// HERE at runtime — NOT via the GitHub contents API, which now 404s (data/ left
// the public repo in the moat cutover) and which would otherwise commit the
// per-tenant vaultKey SECRETS straight into public git.
import { get, put, BlobNotFoundError } from "@vercel/blob";
import type { TenantEntry } from "./history";

const PATH = "data/tenants.json";

// The WRITER (the Polar webhook) reads this before a read-modify-write, so it
// must be FRESH and HONEST about failure:
//   - useCache:false — @vercel/blob get() caches at the CDN by default (~1mo
//     TTL); a stale read between two orders would drop a paid tenant.
//   - a real error (5xx/network) THROWS, it is NOT flattened to [] — otherwise a
//     transient blip looks like "empty registry" and the next write REPLACES the
//     whole file with a single-element array, wiping every existing tenant. Only
//     a genuine 404 (registry not created yet) is the empty case.
export async function readTenantsBlob(): Promise<TenantEntry[]> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN missing");
  let res;
  try {
    res = await get(PATH, { access: "private", token, useCache: false });
  } catch (e) {
    // a missing registry (the first ever tenant) is genuinely empty; ANY other
    // error (5xx/network) must THROW, so we never overwrite the file with a
    // single-element array and wipe every existing tenant.
    if (e instanceof BlobNotFoundError) return [];
    throw e;
  }
  if (!res?.stream) throw new Error("tenants blob read: no stream");
  const j = JSON.parse(await new Response(res.stream).text());
  return Array.isArray(j) ? (j as TenantEntry[]) : [];
}

export async function writeTenantsBlob(tenants: TenantEntry[]): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN missing");
  await put(PATH, JSON.stringify(tenants, null, 2) + "\n", {
    access: "private",
    token,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}
