// Read-only access to the private Blob for the render path, with three honest
// outcomes instead of two. `get()` answers null for a 404 and throws for
// anything else; every reader used to fold both into `null`, and `null` is
// what each surface reads as "not tracked" or "locked". A single 503 then sat
// in unstable_cache for 15 min to 6 h: a paying tenant saw the upsell on the
// Vital Signs they bought, and a valid vault key read as rejected.
//
// So: absent is a 404 and only a 404. A 5xx, a network error, a timeout or a
// body that is not JSON throws BlobReadError, which unstable_cache never
// stores (and on a stale entry it serves the stale value instead).
import { get } from "@vercel/blob";
import { reqLog } from "./log";

export class BlobReadError extends Error {
  name = "BlobReadError";
}

// A render that waits on the store waits for every reader behind it. Shards
// are ~0.7 MB, so a healthy read takes well under a second.
const DEFAULT_TIMEOUT_MS = 8_000;

// undefined = the key does not exist. Throws BlobReadError on anything else.
export async function readPrivateJson<T>(
  key: string,
  token: string,
  { useCache = true, timeoutMs = DEFAULT_TIMEOUT_MS }: { useCache?: boolean; timeoutMs?: number } = {},
): Promise<T | undefined> {
  try {
    const res = await get(key, { access: "private", token, useCache, abortSignal: AbortSignal.timeout(timeoutMs) });
    if (res === null) return undefined;
    if (res.statusCode !== 200 || !res.stream) throw new Error(`unexpected read (${res.statusCode})`);
    return JSON.parse(await new Response(res.stream).text()) as T;
  } catch (err) {
    if (err instanceof BlobReadError) throw err;
    const why = err instanceof Error ? (err.name === "TimeoutError" ? `no answer in ${timeoutMs} ms` : err.message) : String(err);
    throw new BlobReadError(`[blob] ${key}: ${why}`);
  }
}

// What a surface needs to tell the three cases apart.
export type Loaded<T> = { state: "absent" } | { state: "failed" } | { state: "data"; value: T };

// A loader resolves to null (absent) or a value, and rejects on a failed read.
// The failure is logged here, so no surface can swallow it silently.
export async function settle<T>(p: Promise<T | null>, what: string): Promise<Loaded<T>> {
  try {
    const value = await p;
    return value === null ? { state: "absent" } : { state: "data", value };
  } catch (err) {
    reqLog("blob").warn("read.failed", { what, err: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return { state: "failed" };
  }
}

export const valueOf = <T>(l: Loaded<T>): T | null => (l.state === "data" ? l.value : null);
