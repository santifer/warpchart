// Shared Blob helpers for the collector. @vercel/blob is imported lazily so
// modules that import this one stay loadable without it (tests, forks).
//
// readFresh: always from origin. The Blob CDN caches get() for weeks by
// default, so a freshness check or a read-modify-write on a cached copy reads
// the past.
//
// markPartial / markComplete: when a guard (collector/guards.mjs) refuses to
// publish an incomplete artifact, the previous one stays and a marker is left
// at health/partial/{family}.json for the watchdog (data.partial-markers).
// A later complete run flips it to resolved.

let mod = null;
const blob = async () => (mod ??= await import("@vercel/blob"));
const token = () => process.env.BLOB_READ_WRITE_TOKEN;

export async function readFresh(key) {
  if (!token()) return null;
  try {
    const { get } = await blob();
    const res = await get(key, { access: "private", token: token(), useCache: false });
    if (res?.statusCode === 200 && res.stream) return JSON.parse(await new Response(res.stream).text());
  } catch {
    /* missing or transient */
  }
  return null;
}

// true / false / null. null = could not tell (a transient error), which the
// caller must treat as "do not write": only a definite "not found" is false.
export async function blobExists(key) {
  if (!token()) return null;
  const m = await blob();
  try {
    await m.head(key, { token: token() });
    return true;
  } catch (e) {
    if (e instanceof m.BlobNotFoundError || e?.name === "BlobNotFoundError") return false;
    return null;
  }
}

export async function writeJson(key, value) {
  const { put } = await blob();
  await put(key, JSON.stringify(value), {
    access: "private",
    token: token(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

// THE READ-MODIFY-WRITE PATH. readFresh above is for checks that can shrug off
// a miss; a writer that merges into what it read cannot. If a Blob 5xx reads as
// "empty", the merge starts from nothing and the write REPLACES years of vault
// with one run's worth, and GitHub has already discarded the days it held.
//
// readJsonStrict: only a 404 is absence. Anything else (5xx, network, a body
// that is not JSON) throws, so the caller writes nothing.
export async function readJsonStrict(key) {
  if (!token()) throw new Error(`[blob] ${key}: no BLOB_READ_WRITE_TOKEN`);
  const { get } = await blob();
  const res = await get(key, { access: "private", token: token(), useCache: false });
  if (res === null) return { state: "absent" };
  if (res?.statusCode !== 200 || !res.stream) throw new Error(`[blob] ${key}: unexpected read (${res?.statusCode})`);
  return { state: "data", value: JSON.parse(await new Response(res.stream).text()), etag: res.blob?.etag || null };
}

// Conditional write: with an etag, the put only lands if nobody wrote the key
// since we read it (BlobPreconditionFailedError otherwise). Without one (the key
// was absent) it is a plain write.
export async function writeJsonIf(key, value, etag) {
  const { put } = await blob();
  await put(key, JSON.stringify(value), {
    access: "private",
    token: token(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    ...(etag ? { ifMatch: etag } : {}),
  });
}

// A shrink guard's verdict. Thrown from an updateJson merge: nothing is written,
// and the caller leaves a partial marker so the watchdog sees the refusal.
export class RefusedWrite extends Error {
  name = "RefusedWrite";
}

// read -> merge -> conditional write, retried on a lost race. `merge` gets the
// stored value (undefined when absent) and returns the value to write, or
// undefined to write nothing. It may run more than once: keep it pure.
// `read` replaces the plain strict read of `key` (same return shape), for a
// writer that seeds from more than one key (traffic after a rename).
export async function updateJson(key, merge, { attempts = 3, read = () => readJsonStrict(key) } = {}) {
  const m = await blob();
  for (let i = 0; i < attempts; i++) {
    const cur = await read();
    const next = await merge(cur.state === "data" ? cur.value : undefined);
    if (next === undefined) return { written: false, value: cur.state === "data" ? cur.value : undefined };
    try {
      await writeJsonIf(key, next, cur.state === "data" ? cur.etag : null);
      return { written: true, value: next };
    } catch (e) {
      if (e instanceof m.BlobPreconditionFailedError || e?.name === "BlobPreconditionFailedError") continue;
      throw e;
    }
  }
  throw new Error(`[blob] ${key}: lost the write race ${attempts} times`);
}

export const partialKey = (family) => `health/partial/${family}.json`;

// `since` = the FIRST refusal of this episode (kept across refusals, so the
// watchdog can tell a day-old problem from a fresh one); `at` = the latest one;
// `attempts` counts refusals in the episode.
export async function markPartial(family, info) {
  const now = new Date().toISOString();
  const prev = token() ? await readFresh(partialKey(family)) : null;
  const open = prev && prev.resolved === false;
  const marker = {
    family,
    resolved: false,
    since: open ? prev.since ?? prev.at : now,
    at: now,
    attempts: open ? (prev.attempts ?? 1) + 1 : 1,
    ...info,
  };
  // an annotation in the run too, so the refusal is visible without the watchdog
  console.log(`::warning title=${family} kept the previous artifact::${info?.reason ?? "incomplete"}`);
  if (!token()) return marker;
  await writeJson(partialKey(family), marker).catch((e) =>
    console.error(`[blob] could not write the partial marker for ${family}: ${e?.message ?? e}`),
  );
  return marker;
}

// Only writes when an unresolved marker exists, so a healthy run costs one read.
export async function markComplete(family, info) {
  if (!token()) return;
  const prev = await readFresh(partialKey(family));
  if (!prev || prev.resolved) return;
  await writeJson(partialKey(family), { ...prev, resolved: true, resolvedAt: new Date().toISOString(), ...info }).catch(
    () => {},
  );
}
