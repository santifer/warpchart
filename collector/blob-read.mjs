// One read rule for the Blob writers that read-modify-write: a 404 is "not
// there yet" (null), anything else THROWS. Swallowing an error into null made a
// transient 5xx read as an empty shard or an empty archive, and the write-back
// erased it (review of the 2026-11-04 incident). `get` is injected so the rule
// is testable without the network.
export async function readJsonStrict(get, key, { token, useCache = false } = {}) {
  const res = await get(key, { access: "private", token, useCache });
  if (!res || res.statusCode === 404) return null;
  if (res.statusCode !== 200 || !res.stream) throw new Error(`${key}: HTTP ${res.statusCode}`);
  return JSON.parse(await new Response(res.stream).text());
}
