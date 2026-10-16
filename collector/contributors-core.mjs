// GitHub's own contributor count, rebuilt from the commit history so it can be
// DRAWN over time (the count GitHub shows has no dates).
//
// The rule, reverse-engineered on 2026-10-11 against five repos (rendercv,
// JobSpy, Resume-Matcher, Reactive-Resume, career-ops) and GitHub's own
// /graphs/contributors-data list:
//   a contributor is a GitHub ACCOUNT credited on a default-branch commit,
//   as its author OR in a Co-authored-by trailer GitHub links to an account.
//   Bots, service accounts and AI accounts (claude, codex...) count: GitHub
//   counts them. An email linked to no account does not count.
// One cap on top: GitHub links only the first 500 author emails of a repo to
// accounts (documented on REST /contributors). Authors past it turn
// "anonymous" and drop out of the count unless a co-author trailer credits
// them. career-ops on 2026-10-11: exactly 30 one-commit authors, all listed as
// anonymous by /contributors?anon=1.
//
// What is left is a residual of a few people that GitHub computes somewhere we
// cannot see (career-ops: rebuilt 616, shown 614). calibrateToLive() folds it
// in so the curve ends exactly on the number GitHub shows.

// One credit: `login` landed work on `at` (ISO), as author or as co-author.
export function creditGithub(gh, login, at, { co = false } = {}) {
  if (!login || !at) return;
  const k = login.toLowerCase();
  const p = gh[k] ?? { first: at, co: false };
  if (at < p.first) p.first = at;
  if (co) p.co = true;
  gh[k] = p;
}

// One commit's GraphQL `authors` list. GitHub documents the git author as
// ALWAYS the first node; the rest are its Co-authored-by trailers. Crediting
// the first node as a co-author let capped authors whose own commit carried a
// trailer escape the 500-email cap (dry run 2026-10-11: 4 people, 620 vs 615).
export function creditCommitAuthors(gh, nodes, at) {
  (nodes ?? []).forEach((n, k) => creditGithub(gh, n?.user?.login ?? null, at, { co: k > 0 }));
}

// The count GitHub shows, as a daily cumulative series. `listed` = the
// lowercase logins GitHub's /contributors still links (the 500-email cap), or
// null when that list could not be read: then no cap is applied and the
// caller must say so.
export function githubSeries(gh, listed) {
  const L = listed ? new Set(listed) : null;
  const firsts = [];
  let capped = 0;
  for (const [login, p] of Object.entries(gh)) {
    if (L && !p.co && !L.has(login)) {
      capped++;
      continue;
    }
    firsts.push(p.first);
  }
  const perDay = new Map();
  for (const d of firsts) {
    const day = d.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  let cum = 0;
  const daily = [...perDay.keys()].sort().map((day) => [day, (cum += perDay.get(day))]);
  return { daily, total: firsts.length, capped, capApplied: !!L, uncapped: firsts.length + capped };
}

// Make the rebuilt curve end on the live figure GitHub shows. Scales every
// point by live/total and rounds: whole people, never decreasing, last point
// exactly `live`. Refuses (null) when the gap is larger than `tolPct`: past
// that the rebuild is measuring something else and stretching it would hide it.
// 2%, not 5%: the residuals measured were 0-0.9% (5 repos, 2026-10-11), while a
// rebuild WITHOUT the email cap was 4.5% off and slipped under a 5% bar.
//
// `uncapped` (optional): the same rebuild WITHOUT the 500-email cap. GitHub's
// sidebar keeps counting some authors past the cap that /contributors turns
// anonymous (career-ops: 30 capped on 10-11, 52 on 10-16, while the live count
// went 614 -> 634 and the capped rebuild only 616 -> 620). The truth then lies
// BETWEEN the two rebuilds, so a live figure inside [capped, uncapped] is not a
// different measurement, it is the cap's blind spot: calibrate. Outside that
// bracket (plus tolPct) it still refuses.
// The bracket is bounded: if the uncapped rebuild sits more than
// MAX_CAP_BRACKET_PCT above the capped one, the census itself is suspect
// (wrong store, rename carried another repo's people) and it does not open.
export const MAX_CAP_BRACKET_PCT = 15;
export function calibrateToLive(daily, live, tolPct = 2, { uncapped = null, bracketTolPct = 2 } = {}) {
  if (!Array.isArray(daily) || !daily.length || !Number.isInteger(live) || live <= 0) return null;
  const total = daily[daily.length - 1][1];
  if (!total) return null;
  const gapPct = (Math.abs(live - total) / total) * 100;
  const bracketed =
    Number.isInteger(uncapped) &&
    uncapped > total &&
    ((uncapped - total) / total) * 100 <= MAX_CAP_BRACKET_PCT &&
    live >= total &&
    live <= uncapped * (1 + bracketTolPct / 100);
  if (gapPct > tolPct && !bracketed) return null;
  const k = live / total;
  let prev = 0;
  const out = [];
  for (const [day, v] of daily) {
    const s = Math.max(prev, Math.round(v * k));
    out.push([day, s]);
    prev = s;
  }
  out[out.length - 1][1] = live;
  return { daily: out, rebuilt: total, residual: live - total };
}
