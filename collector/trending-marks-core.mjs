// Pure core of collector/trending-marks.mjs: read a github.com/trending page
// and fold one snapshot into the running record of the days the tracked repo
// was seen there. No I/O, so the tests run on real pages.
//
// The record (Blob trending/marks.json):
//   { v, since, lastCheck, tracked: [repo],
//     checks: { [day]: { [list]: snapshots that parsed } },
//     marks:  { [repo]: { [day]: { [list]: { pos, seen, first, last } } } } }
// `checks` is what makes an absence readable: a day with checks and no mark
// was looked at and the repo was not there; a day without checks says nothing.

export const LISTS = {
  all: "https://github.com/trending?since=daily",
  javascript: "https://github.com/trending/javascript?since=daily",
};

// a real list has 7-25 rows; fewer than this is a page we did not understand
// (a layout change, a rate-limit page), never "a short list without us"
export const MIN_ROWS = 3;

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/");

// owner/name of every row, in order, lowercased
export function parseTrending(html) {
  const out = [];
  for (const m of String(html).matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g)) {
    const h = m[1].match(/<h2[^>]*>[\s\S]*?href="([^"]+)"/);
    if (!h) continue;
    let href = decode(h[1]);
    // signed out, GitHub can wrap the link in /login?return_to=%2Fowner%2Fname
    if (href.includes("return_to=")) {
      try {
        href = decodeURIComponent(href.split("return_to=").pop());
      } catch {
        continue; // a malformed escape: skip the row, never the page
      }
    }
    const repo = href.replace(/^https?:\/\/github\.com/, "").replace(/^\/+|\/+$/g, "").split(/[?#]/)[0];
    if (/^[\w.-]+\/[\w.-]+$/.test(repo)) out.push(repo.toLowerCase());
  }
  return out;
}

// Fold one snapshot in. `lists` = { [list]: rows | null } (null = that page
// failed: not counted as checked). `names` maps every lowercased name a
// tracked repo carried to its canonical name. Never drops anything from prev.
export function recordSnapshot(prev, { at, lists, names }) {
  const day = at.slice(0, 10);
  const next = structuredClone(prev ?? { v: 1, since: at, lastCheck: null, tracked: [], checks: {}, marks: {} });
  // which repos this record watches: only for these does a checked day with
  // no mark mean "not there"
  next.tracked = [...new Set([...(next.tracked ?? []), ...names.values()])].sort();
  for (const [list, rows] of Object.entries(lists)) {
    if (!rows || rows.length < MIN_ROWS) continue;
    next.checks[day] ??= {};
    next.checks[day][list] = (next.checks[day][list] ?? 0) + 1;
    rows.forEach((repo, i) => {
      const canonical = names.get(repo);
      if (!canonical) return;
      const byDay = ((next.marks[canonical] ??= {})[day] ??= {});
      const cur = byDay[list];
      byDay[list] = cur
        ? { pos: Math.min(cur.pos, i + 1), seen: cur.seen + 1, first: cur.first, last: at }
        : { pos: i + 1, seen: 1, first: at, last: at };
    });
    next.lastCheck = at;
  }
  return next;
}

// Refuse a write that would lose history: every checked day and every mark of
// prev must still be there.
export function losesHistory(prev, next) {
  if (!prev) return null;
  for (const day of Object.keys(prev.checks ?? {})) if (!next.checks?.[day]) return `checked day ${day} would disappear`;
  for (const [repo, days] of Object.entries(prev.marks ?? {}))
    for (const day of Object.keys(days)) if (!next.marks?.[repo]?.[day]) return `mark ${repo} ${day} would disappear`;
  return null;
}

// The repo's marks as the panel reads them: one entry per (day, list).
export function marksOf(record, repo) {
  const days = record?.marks?.[repo] ?? {};
  return Object.entries(days)
    .flatMap(([day, lists]) => Object.entries(lists).map(([list, m]) => ({ day, list, pos: m.pos, seen: m.seen })))
    .sort((a, b) => (a.day === b.day ? a.list.localeCompare(b.list) : a.day < b.day ? -1 : 1));
}
