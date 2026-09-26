// Validate-before-publish rules for the collector's artifacts. Pure, so the
// tests can pin them. A guard that refuses returns { ok:false, reason } and the
// caller keeps the previous artifact and leaves a partial marker: an honest gap
// beats a truncated day, because a truncated day never throws and makes every
// rank computed on it look better than it is (2026-09-03 recorded 4,039 of
// ~10,000 repos, 2026-09-11 recorded 6,012, and both read as normal days).

// A sweep of the top-N must reach most of N, and must not shrink sharply
// against the last accepted sweep (the population of the top-N is stable).
export function acceptUniverse(got, { want, prev = null, ratio = 0.9 } = {}) {
  if (!Number.isFinite(got) || got <= 0) return { ok: false, reason: "empty sweep" };
  if (want && got < want * ratio) {
    return { ok: false, reason: `sweep reached ${got} of ${want} (< ${Math.round(ratio * 100)}%)` };
  }
  if (prev && got < prev * ratio) {
    return { ok: false, reason: `sweep reached ${got}, last accepted day had ${prev} (< ${Math.round(ratio * 100)}%)` };
  }
  return { ok: true, reason: null };
}

// PR flow is a full recompute from every PR the repo ever had, so the count of
// human PRs can only fall if GitHub deletes some (rare: spam removals). A drop
// beyond a small tolerance means the pagination stopped early.
// A REAL drop (a spam purge, a login added to the bot list) would otherwise
// freeze the panel until the count climbed back. The way out: a cut-short
// pagination does not repeat to the exact number, so the same count on two
// consecutive refused runs (`pendingGot`) is accepted as the new truth. The
// tolerance has an absolute floor so a small repo is not blocked by 3 PRs.
export function acceptPrCount(got, prev, { tolerance = 0.02, floor = 10, pendingGot = null } = {}) {
  if (!prev) return { ok: true, reason: null };
  if (prev - got <= Math.max(prev * tolerance, floor)) return { ok: true, reason: null };
  if (pendingGot === got) return { ok: true, reason: `confirmed on two runs: ${prev} -> ${got}` };
  return { ok: false, reason: `${got} human PRs, the last run had ${prev} (pagination stopped early?)` };
}
