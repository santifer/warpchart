// The app's read-modify-write path to the private Blob, mirror of
// collector/blob.mjs. A writer that merges into what it read must never take a
// failed read for an empty store: the merge starts from nothing and the write
// replaces the stored map with one request's worth (every earned badge, every
// embed sighting, every alert watermark). tenants-store.ts is the model.
import { get, put, BlobPreconditionFailedError } from "@vercel/blob";

export type StrictRead<T> = { state: "absent" } | { state: "data"; value: T; etag: string | null };

function token(): string {
  const t = process.env.BLOB_READ_WRITE_TOKEN;
  if (!t) throw new Error("BLOB_READ_WRITE_TOKEN missing");
  return t;
}

// Fresh from origin (useCache:false; the CDN copy can be weeks old) and honest:
// only a 404 is absence. A 5xx, a network error or a body that is not JSON
// throws, so the caller writes nothing.
export async function readJsonStrict<T>(key: string): Promise<StrictRead<T>> {
  const res = await get(key, { access: "private", token: token(), useCache: false });
  if (res === null) return { state: "absent" };
  if (res.statusCode !== 200 || !res.stream) throw new Error(`[blob] ${key}: unexpected read (${res.statusCode})`);
  return { state: "data", value: JSON.parse(await new Response(res.stream).text()) as T, etag: res.blob?.etag || null };
}

// With an etag the put only lands if nobody wrote the key since our read.
export async function writeJsonIf(key: string, value: unknown, etag: string | null): Promise<void> {
  await put(key, JSON.stringify(value), {
    access: "private",
    token: token(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    ...(etag ? { ifMatch: etag } : {}),
  });
}

// A shrink guard's verdict, thrown from a merge: nothing is written.
export class RefusedWrite extends Error {
  name = "RefusedWrite";
}

// read -> merge -> conditional write, retried when another writer got there
// first. `merge` gets the stored value (undefined when absent) and returns the
// value to write, or undefined to write nothing. It may run more than once.
export async function updateJson<T>(
  key: string,
  merge: (stored: T | undefined) => T | undefined,
  { attempts = 3 } = {},
): Promise<{ written: boolean; value: T | undefined }> {
  for (let i = 0; i < attempts; i++) {
    const cur = await readJsonStrict<T>(key);
    const stored = cur.state === "data" ? cur.value : undefined;
    const next = merge(stored);
    if (next === undefined) return { written: false, value: stored };
    try {
      await writeJsonIf(key, next, cur.state === "data" ? cur.etag : null);
      return { written: true, value: next };
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) continue;
      throw e;
    }
  }
  throw new Error(`[blob] ${key}: lost the write race ${attempts} times`);
}

// A map that only grows: every stored key must survive the merge.
export function keepsEveryKey(before: object | undefined, after: object, what: string): void {
  const lost = Object.keys(before ?? {}).filter((k) => !(k in after));
  if (lost.length) throw new RefusedWrite(`${what}: the write would drop ${lost.length} stored key(s)`);
}
