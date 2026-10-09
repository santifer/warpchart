// npm's daily download series has HOLES: days it never recorded, served as
// `downloads: 0`. For @santifer/career-ops (~300/day) 2026-09-08, 09-15, 10-05
// and 10-06 all read 0, and npm only backfills some of them, days later (09-17
// and 09-18 came back; 09-08 never did). Read as data, a hole is a confident
// lie twice over: the chart dips to zero, and npm's own last-month total sums
// the hole as nothing, so the "NPM INSTALLS · 30D" a sponsor reads was missing
// 4 of its 30 days (8,681 published on 2026-10-09).
//
// The rule: a zero is a hole when the package's own neighbourhood says zero is
// impossible (median of the non-zero days within a week either side >= 20).
// A small package that genuinely has quiet days keeps its zeros. Unknown is
// never filled in: holes are DROPPED from the series (the chart bridges them)
// and COUNTED next to the 30-day total, which then reads as a lower bound.

export interface NpmDay {
  day: string;
  d: number;
}

const NEIGHBOURHOOD = 7; // days either side
const MIN_TYPICAL = 20; // below this, a real zero day is plausible

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Days npm failed to record. Trailing zeros are not holes but days npm has not
// published yet, and are handled by cleanNpmSeries.
export function npmHoles(series: NpmDay[]): Set<string> {
  const holes = new Set<string>();
  series.forEach((p, i) => {
    if (p.d !== 0) return;
    const around = series
      .slice(Math.max(0, i - NEIGHBOURHOOD), i + NEIGHBOURHOOD + 1)
      .map((q) => q.d)
      .filter((d) => d > 0);
    if (around.length >= 3 && median(around) >= MIN_TYPICAL) holes.add(p.day);
  });
  return holes;
}

// The series as npm actually measured it, holes removed. npm does not serve
// unpublished days at all (range/last-year ends on the same day as
// point/last-month), so a zero at the END is a hole like any other: trimming
// it as "not published yet" moved "through" back and hid the newest holes.
export function cleanNpmSeries(series: NpmDay[]): { series: NpmDay[]; holes: string[] } {
  const holes = npmHoles(series);
  return { series: series.filter((p) => !holes.has(p.day)), holes: [...holes].sort() };
}

// The holes inside npm's own window [start, end] (inclusive): the days its
// last-month total is missing.
export function holesInWindow(holes: string[], start: string, end: string): string[] {
  return holes.filter((h) => h >= start && h <= end);
}

// A labelled ESTIMATE of what npm failed to record: each hole takes the mean of
// the 3 measured days either side. Measured over 113 days of this package, that
// rule misses a single day by ~25 % on average; git clones were tested as a
// predictor and correlate at r = -0.06 (they are mostly CI), so they are not
// used. Never presented without the measured figure next to it.
export function estimateHoles(series: NpmDay[], holes: string[]): number {
  const measured = series.filter((p) => !holes.includes(p.day) && p.d > 0);
  let total = 0;
  for (const h of holes) {
    const before = measured.filter((p) => p.day < h).slice(-3);
    const after = measured.filter((p) => p.day > h).slice(0, 3);
    const around = [...before, ...after];
    if (around.length) total += around.reduce((a, p) => a + p.d, 0) / around.length;
  }
  return Math.round(total);
}
