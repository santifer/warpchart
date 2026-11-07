// Rules the collector and the app must apply identically. Pure, built-ins only.
// The app keeps its own TypeScript twins (src/lib/rank-history.ts shardOf,
// src/lib/milestones.ts, src/lib/velocity.ts, src/lib/rank.ts) because it does
// not import collector code; src/lib/parity.test.ts imports BOTH and fails on
// any drift. Change one, change the other, in the same commit.

// The rank-history index is split in SHARDS files, keyed by this hash. A
// different hash on either side reads the wrong shard: the repo shows no
// history at all, and nothing throws.
export const SHARDS = 32;

// deterministic fnv-1a over the lowercased name
export function shardOf(repo) {
  let h = 2166136261;
  const s = repo.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % SHARDS;
}

// Next round-number rank milestones below the current rank.
// rank 409 -> [400, 300, 200, 100]; rank 101 -> [100, 90, 80, 70]; rank 4870 -> [4000, 3000, 2000, 1000].
export function nextMilestones(rank, count = 4) {
  if (!Number.isFinite(rank) || rank <= 1) return [];
  const out = [];
  let unit = Math.pow(10, Math.floor(Math.log10(rank - 1)));
  let m = Math.floor((rank - 1) / unit) * unit;
  while (out.length < count && m >= 1) {
    out.push(m);
    if (m - unit < 1 && unit > 1) unit = unit / 10;
    m -= unit;
  }
  return out;
}

// Canonical stars/day of a registry entry: the 7-day rate, the ~1-day diff
// only while there is no 7-day baseline, null when neither is known.
export const canonicalVelocity = (p) => p?.v7 ?? p?.v ?? null;

// Worldwide rank: 1 + the number of repos with strictly MORE stars. GitHub's
// search answers it live (`stars:>N`); the registry answers it offline by
// counting, never by array position (the registry reorders once a day while
// its star counts refresh every 2 h).
export const rankQuery = (stars) => `stars:>${stars}`;
export const rankByStars = (repos, stars) => repos.reduce((n, p) => (p.s > stars ? n + 1 : n), 1);
