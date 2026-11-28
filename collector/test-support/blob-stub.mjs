// A stand-in for @vercel/blob when a collector script runs under a test
// (see blob-harness.mjs). The store is a JSON file named by BLOB_STUB:
//   { blobs: { key: value }, fail: { key: 503 } }
// and every get/put is appended to BLOB_STUB_LOG, so a test can assert what a
// script read and, above all, whether it wrote.
import { readFileSync, appendFileSync } from "node:fs";

export class BlobError extends Error {}
export class BlobNotFoundError extends BlobError {
  name = "BlobNotFoundError";
}
export class BlobPreconditionFailedError extends BlobError {
  name = "BlobPreconditionFailedError";
}

const state = () => JSON.parse(readFileSync(process.env.BLOB_STUB, "utf8"));
const log = (op, key, extra) => appendFileSync(process.env.BLOB_STUB_LOG, JSON.stringify({ op, key, ...extra }) + "\n");

// the same contract as the real get(): null on 404, a BlobError on anything else
export async function get(key, opts = {}) {
  log("get", key, { useCache: opts.useCache ?? true });
  const s = state();
  if (s.fail?.[key]) throw new BlobError(`Failed to fetch blob: ${s.fail[key]} Service Unavailable`);
  if (!(key in (s.blobs ?? {}))) return null;
  return {
    statusCode: 200,
    stream: new Response(JSON.stringify(s.blobs[key])).body,
    headers: new Headers(),
    blob: { pathname: key, etag: `"etag-${key}"` },
  };
}

export async function head(key) {
  if (!(key in (state().blobs ?? {}))) throw new BlobNotFoundError();
  return { pathname: key };
}

export async function put(key, body, opts = {}) {
  log("put", key, { ifMatch: opts.ifMatch ?? null, body: JSON.parse(body) });
  return { pathname: key };
}

export async function list({ prefix = "" } = {}) {
  const blobs = Object.keys(state().blobs ?? {})
    .filter((k) => k.startsWith(prefix))
    .map((pathname) => ({ pathname }));
  return { blobs, cursor: undefined };
}
