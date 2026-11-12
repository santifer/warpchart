// What scripts/sync-to-blob.mjs uploads, as a pure function so the tests can
// replay a mirror run against the watchdog's inventory (collector/health.mjs).

export const PREFIX = "data/";

// Keys under data/ that have their OWN writer straight to the Blob. The run's
// local copy of each one is only what sync-from-blob hydrated at the start, so
// mirroring it back up does two kinds of harm:
// - tenants.json: the Polar webhook (src/lib/tenants-store.ts) is its only
//   writer. A copy that predates a webhook landing mid-run, between hydrate and
//   mirror, would silently clobber a just-paid tenant.
// - catalog.json (collector/catalog.mjs), attribution.json
//   (collector/attribute.mjs), enrichment.json (collector/enrich.mjs): the
//   watchdog's inventory.coverage dates them by Blob uploadedAt. Re-uploading
//   the hydrated copy every run refreshed that date, so a producer that stopped
//   still read as fresh. The mirror also runs between hydrate and enrich.mjs's
//   own writes, so it could revert a newer enrichment.json.
export const MIRROR_SKIP = new Set(["tenants.json", "catalog.json", "attribution.json", "enrichment.json"]);

// rels: paths relative to data/, with "/" separators. Returns the Blob keys the
// mirror writes.
export function mirrorKeys(rels) {
  return rels.filter((rel) => !MIRROR_SKIP.has(rel)).map((rel) => PREFIX + rel);
}
