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
