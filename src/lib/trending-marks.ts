// Days a repo was seen on GitHub Trending, drawn as marks on the x-axis of the
// daily velocity-rank panel (GodVelocityRank). Only career-ops for now, from a
// FIXED list: there is no collector behind it, so a new appearance after
// `checkedThrough` is not here until someone rescans and edits this file.
//
// Source: the public bonfy/github-trending archive, one snapshot a day around
// 07:15 UTC of the python, javascript, go and swift daily lists
// (raw.githubusercontent.com/bonfy/github-trending/master/YYYY-MM-DD.md).
// Scanned from career-ops' birth (4 Apr 2026) to `checkedThrough`, under both
// names; every day has a file except 3 Sep 2026. career-ops only ever shows in
// the javascript list.
//
// What it does NOT say: one snapshot a day is a floor (it may have trended at
// other hours), and the general list is not archived. A day without a mark is
// "not seen", never "not trending". The April-May wave has no mark at all.
import { canonicalRepo } from "./aliases";

export interface TrendingMark {
  day: string; // UTC day of the snapshot
  list: "javascript";
  pos: number; // place in that list, 1 = top
}

export interface TrendingMarks {
  marks: TrendingMark[];
  source: string;
  snapshotUtc: string;
  checkedThrough: string; // last archive day scanned: after it, no claim either way
}

const CAREER_OPS: [string, number][] = [
  ["2026-06-06", 3], ["2026-06-07", 3], ["2026-06-08", 2], ["2026-06-09", 1], ["2026-06-10", 1], ["2026-06-11", 2],
  ["2026-06-12", 1], ["2026-06-28", 2], ["2026-06-29", 2], ["2026-06-30", 4], ["2026-07-01", 1], ["2026-07-03", 2],
  ["2026-07-04", 3], ["2026-07-05", 10], ["2026-07-12", 15], ["2026-07-16", 3], ["2026-07-21", 13], ["2026-07-24", 7],
  ["2026-07-25", 2], ["2026-07-27", 5], ["2026-07-28", 8], ["2026-08-07", 3], ["2026-08-12", 3], ["2026-08-15", 6],
  ["2026-08-18", 1], ["2026-08-19", 1], ["2026-08-20", 1], ["2026-08-21", 1], ["2026-08-22", 1], ["2026-08-23", 2],
  ["2026-09-01", 3],
];

const COVERED: Record<string, TrendingMarks> = {
  "career-ops-hq/career-ops": {
    marks: CAREER_OPS.map(([day, pos]) => ({ day, list: "javascript", pos })),
    source: "bonfy/github-trending",
    snapshotUtc: "07:15",
    checkedThrough: "2026-10-21",
  },
};

// null = this repo's Trending history is not tracked (draw nothing, claim
// nothing), never an empty list read as "never trended"
export function trendingMarksFor(repo: string): TrendingMarks | null {
  return COVERED[canonicalRepo(repo).toLowerCase()] ?? null;
}
