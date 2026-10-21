// Days a repo was seen on GitHub Trending, drawn as marks on the x-axis of the
// daily velocity-rank panel (GodVelocityRank). Two sources, merged here:
//
// 1. ARCHIVE, a FIXED list (career-ops only): the public bonfy/github-trending
//    archive, one snapshot a day around 07:15 UTC of the python, javascript, go
//    and swift daily lists (raw.githubusercontent.com/bonfy/github-trending/
//    master/YYYY-MM-DD.md), scanned from career-ops' birth (4 Apr 2026) to
//    `through`, under both names; every day has a file except 3 Sep 2026.
//    career-ops only ever shows in the javascript list.
// 2. LIVE: collector/trending-marks.mjs reads github.com/trending (general and
//    javascript) on every collect run and keeps the house repo's days in the
//    private Blob (trending/marks.json), from 21 Oct 2026 on.
//
// What it does NOT say: both are snapshots (one a day, one per collect run), so
// they are a floor; the general list is not in the archive. A day without a
// mark is "not seen", never "not trending". The April-May wave has no mark.
import { canonicalRepo } from "./aliases";

export type TrendingList = "all" | "javascript";

export interface TrendingMark {
  day: string; // UTC day of the snapshot
  list: TrendingList;
  pos: number; // best place in that list that day, 1 = top
}

export interface TrendingMarks {
  marks: TrendingMark[];
  // what was looked at, for the footnote: each source's own window
  archive: { source: string; snapshotUtc: string; through: string } | null;
  live: { since: string; lastCheck: string } | null;
}

// the Blob record written by collector/trending-marks-core.mjs
export interface TrendingLiveRecord {
  since: string;
  lastCheck: string | null;
  tracked?: string[];
  marks?: Record<string, Record<string, Partial<Record<TrendingList, { pos: number }>>>>;
}

const CAREER_OPS: [string, number][] = [
  ["2026-06-06", 3], ["2026-06-07", 3], ["2026-06-08", 2], ["2026-06-09", 1], ["2026-06-10", 1], ["2026-06-11", 2],
  ["2026-06-12", 1], ["2026-06-28", 2], ["2026-06-29", 2], ["2026-06-30", 4], ["2026-07-01", 1], ["2026-07-03", 2],
  ["2026-07-04", 3], ["2026-07-05", 10], ["2026-07-12", 15], ["2026-07-16", 3], ["2026-07-21", 13], ["2026-07-24", 7],
  ["2026-07-25", 2], ["2026-07-27", 5], ["2026-07-28", 8], ["2026-08-07", 3], ["2026-08-12", 3], ["2026-08-15", 6],
  ["2026-08-18", 1], ["2026-08-19", 1], ["2026-08-20", 1], ["2026-08-21", 1], ["2026-08-22", 1], ["2026-08-23", 2],
  ["2026-09-01", 3],
];

const ARCHIVE: Record<string, { marks: TrendingMark[]; through: string }> = {
  "career-ops-hq/career-ops": {
    marks: CAREER_OPS.map(([day, pos]) => ({ day, list: "javascript", pos })),
    through: "2026-10-21",
  },
};

// null = this repo's Trending history is not tracked by either source (draw
// nothing, claim nothing), never an empty list read as "never trended". A live
// record that failed to read (null) leaves the archive alone.
export function trendingMarksFor(repo: string, live: TrendingLiveRecord | null = null): TrendingMarks | null {
  const key = canonicalRepo(repo).toLowerCase();
  const arch = ARCHIVE[key] ?? null;
  // tracked names are the canonical name at write time: resolve them again, so
  // a later rename still finds the repo's live days
  const liveKey = live?.tracked?.find((r) => canonicalRepo(r).toLowerCase() === key);
  const watched = liveKey && live?.lastCheck ? live : null;
  if (!arch && !watched) return null;

  const best = new Map<string, TrendingMark>();
  const add = (m: TrendingMark) => {
    const k = `${m.day}|${m.list}`;
    const cur = best.get(k);
    if (!cur || m.pos < cur.pos) best.set(k, m);
  };
  arch?.marks.forEach(add);
  if (watched && liveKey) {
    for (const [day, lists] of Object.entries(watched.marks?.[liveKey] ?? {}))
      for (const [list, m] of Object.entries(lists))
        if (m && (list === "all" || list === "javascript")) add({ day, list, pos: m.pos });
  }
  return {
    marks: [...best.values()].sort((a, b) => (a.day === b.day ? a.list.localeCompare(b.list) : a.day < b.day ? -1 : 1)),
    archive: arch ? { source: "bonfy/github-trending", snapshotUtc: "07:15", through: arch.through } : null,
    live: watched ? { since: watched.since, lastCheck: watched.lastCheck! } : null,
  };
}
