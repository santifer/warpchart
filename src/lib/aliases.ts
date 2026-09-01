// Repo renames/transfers (e.g. santifer/career-ops -> career-ops-hq/career-ops
// on 2026-08-31). GitHub 301s the old name at the HTTP layer, but everything
// WE key by full_name (rank-history shards, tenant dirs, traffic/vitals Blob
// keys, /r/ routes, ?repo= params) splits into two identities the moment the
// daily top-10k search starts returning the new name. This map is the single
// curated source of truth: old name -> canonical name. The collector detects
// divergence (collect.mjs warns when GraphQL resolves a different
// nameWithOwner than configured); a human adds the entry here.
//
// NEVER delete an entry: the old shards/blobs keep that name forever, and the
// merged read in rank-history/traffic/vitals depends on knowing it.
import aliasesJson from "../../mission.aliases.json";

const OLD_TO_CANONICAL = new Map<string, string>(
  Object.entries(aliasesJson as Record<string, string>).map(([o, c]) => [o.toLowerCase(), c]),
);

// Resolve any historical name to the repo's canonical (current) name.
// Case-insensitive; unknown names pass through untouched. Follows chains
// (a->b, b->c) defensively, though entries should be kept flattened.
export function canonicalRepo(repo: string): string {
  let cur = repo;
  for (let hops = 0; hops < 4; hops++) {
    const next = OLD_TO_CANONICAL.get(cur.toLowerCase());
    if (!next || next.toLowerCase() === cur.toLowerCase()) break;
    cur = next;
  }
  return cur;
}

// Every name this repo has ever carried, canonical LAST (so that in
// last-write-wins day merges the canonical series overrides alias overlap).
export function allNamesOf(repo: string): string[] {
  const canonical = canonicalRepo(repo);
  const lower = canonical.toLowerCase();
  const olds: string[] = [];
  for (const [o, c] of OLD_TO_CANONICAL) {
    if (canonicalRepo(c).toLowerCase() === lower && o !== lower) olds.push(o);
  }
  return [...olds, canonical];
}

export function isAliasOf(repo: string): boolean {
  return canonicalRepo(repo).toLowerCase() !== repo.toLowerCase();
}
