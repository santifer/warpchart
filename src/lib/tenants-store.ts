// The tenant registry (paying missions) lives in the PRIVATE Blob under the same
// data/ prefix the moat uses, so sync-from-blob mirrors it to disk at build time
// and loadTenants() reads that disk copy. The Polar webhook reads + writes it
// HERE at runtime — NOT via the GitHub contents API, which now 404s (data/ left
// the public repo in the moat cutover) and which would otherwise commit the
// per-tenant vaultKey SECRETS straight into public git.
import { get, put } from "@vercel/blob";
import type { TenantEntry } from "./history";

const PATH = "data/tenants.json";

export async function readTenantsBlob(): Promise<TenantEntry[]> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return [];
  try {
    const res = await get(PATH, { access: "private", token });
    if (!res || res.statusCode !== 200 || !res.stream) return [];
    const j = JSON.parse(await new Response(res.stream).text());
    return Array.isArray(j) ? (j as TenantEntry[]) : [];
  } catch {
    return [];
  }
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
