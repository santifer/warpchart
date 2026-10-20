// Pure view math for the daily velocity-rank chart (GodVelocityRank): a
// trailing median that shows the trend under day-to-day noise, and the
// "this week vs the week before" summary. Client-safe, no I/O.

export interface RankPoint {
  day: string;
  rank: number | null;
}

const DAY = 864e5;
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// Median rank of the measured days inside [day - (window-1), day], by CALENDAR
// day (a gap is not borrowed from older days). null below `min` measured days,
// so a week that is mostly holes draws no trend rather than a confident one.
export function trailingMedian(points: RankPoint[], window = 7, min = 4): (number | null)[] {
  return points.map((p) => {
    const end = ms(p.day);
    const xs = points
      .filter((q) => q.rank != null && ms(q.day) <= end && ms(q.day) > end - window * DAY)
      .map((q) => q.rank as number);
    return xs.length >= min ? median(xs) : null;
  });
}

// The last 7 calendar days against the 7 before, both ending on the newest
// measured day. null where a week has fewer than 4 measured days.
export function weekOverWeek(points: RankPoint[]): {
  lastDay: string | null;
  last: number | null;
  thisWeek: number | null;
  prevWeek: number | null;
  best: { day: string; rank: number } | null;
} {
  const measured = points.filter((p) => p.rank != null) as { day: string; rank: number }[];
  if (!measured.length) return { lastDay: null, last: null, thisWeek: null, prevWeek: null, best: null };
  const lastP = measured[measured.length - 1];
  const end = ms(lastP.day);
  const inWeek = (k: number) =>
    measured.filter((p) => ms(p.day) <= end - k * 7 * DAY && ms(p.day) > end - (k + 1) * 7 * DAY).map((p) => p.rank);
  const w0 = inWeek(0);
  const w1 = inWeek(1);
  const best = measured.reduce((b, p) => (p.rank < b.rank ? p : b), measured[0]);
  return {
    lastDay: lastP.day,
    last: lastP.rank,
    thisWeek: w0.length >= 4 ? median(w0) : null,
    prevWeek: w1.length >= 4 ? median(w1) : null,
    best: { day: best.day, rank: best.rank },
  };
}

// Every calendar day from the first point to the last, a missing day as
// { day, rank: null }. The day table only holds days it could measure, so
// without this a chart line runs straight across a gap (1-6 Jul looked like a
// smooth week instead of six unmeasured days).
export function fillCalendar<T extends RankPoint>(points: T[]): (T | RankPoint)[] {
  if (!points.length) return [];
  const byDay = new Map(points.map((p) => [p.day, p]));
  const out: (T | RankPoint)[] = [];
  for (let t = ms(points[0].day); t <= ms(points[points.length - 1].day); t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, rank: null });
  }
  return out;
}

// Round Y ticks for a reversed rank axis: #1 then multiples of a round step.
export function rankTicks(max: number): number[] {
  const step = [10, 25, 50, 100, 250].find((s) => max / s <= 6) ?? 500;
  const ticks = [1];
  for (let v = step; v <= max; v += step) ticks.push(v);
  return ticks;
}

// Rarity tiers over the rank axis, RPG-style (orange legendary down to grey
// common), so a glance at the chart says which zone a day landed in. Round
// cut-offs on purpose: they are read as "top 10 / top 50 / top 100 / top 250".
export const TIERS = [
  { key: "legendary", label: "LEGENDARY · TOP 10", from: 1, to: 10 },
  { key: "epic", label: "EPIC · TOP 50", from: 11, to: 50 },
  { key: "rare", label: "RARE · TOP 100", from: 51, to: 100 },
  { key: "uncommon", label: "UNCOMMON · TOP 250", from: 101, to: 250 },
  { key: "common", label: "COMMON", from: 251, to: 1000 },
] as const;
export type TierKey = (typeof TIERS)[number]["key"];

export function tierOf(rank: number): (typeof TIERS)[number] {
  return TIERS.find((t) => rank <= t.to) ?? TIERS[TIERS.length - 1];
}

// The first day of every month strictly after the first point and up to the
// last: where a month-boundary line goes. ISO days.
export function monthStarts(firstDay: string, lastDay: string): string[] {
  const out: string[] = [];
  const [y0, m0] = firstDay.split("-").map(Number);
  for (let y = y0, m = m0 + 1; ; m++) {
    if (m > 12) { m = 1; y++; }
    const d = `${y}-${String(m).padStart(2, "0")}-01`;
    if (d > lastDay) break;
    out.push(d);
  }
  return out;
}

// The last `days` calendar days ending on the newest point (0 = everything).
// Slice AFTER computing the trailing median on the full series, so the first
// days of a 30-day view keep the median of the week before them.
export function lastDays<T extends { day: string }>(points: T[], days: number): T[] {
  if (!days || !points.length) return points;
  const cut = ms(points[points.length - 1].day) - (days - 1) * DAY;
  return points.filter((p) => ms(p.day) >= cut);
}
