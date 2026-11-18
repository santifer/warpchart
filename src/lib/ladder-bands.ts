// Background zones for the daily ladder: how many stars a day needed to rank
// top 10 / 50 / 100 / 250 by NEW stars among the 1,000 most-starred repos (the
// velocity-rank universe, fixed at each day's close: a viral newcomer outside
// it never enters the table), one value per month.
// Built from the same day table as the daily velocity rank
// (collector/velocity-rank.mjs: each day's top-1,000 gains), with the same
// rarity tiers and colours, so the two panels speak one language. Pure and
// client-safe: the server computes the bands (velocity-rank.ts ladderBands),
// the ladder only draws them.
//
// Why a MONTHLY median and not the day's own threshold: the day's cut-off
// swings too much to sit behind the bars (top 50 went from 114 to 393 stars
// inside October 2026), so a daily band reads as one more data series. A month
// is a clean block with an honest step where the bar actually moved.
import type { TierKey } from "./velocity-rank-view";

export type BandTier = Exclude<TierKey, "common">;

// top to bottom; the rank each zone starts at (TIERS in velocity-rank-view)
export const BAND_TIERS: { key: BandTier; rank: number }[] = [
  { key: "legendary", rank: 10 },
  { key: "epic", rank: 50 },
  { key: "rare", rank: 100 },
  { key: "uncommon", rank: 250 },
];

export interface LadderBand {
  month: string; // "2026-10"
  from: string; // first ISO day the zone covers (the record's first day for the first month)
  to: string; // last ISO day of the month
  // "month" = median of that month's own measured days; "trailing30" = the
  // month has too few of them yet (a new month), so the 30 days up to its last
  // measured day stand in, the previous month's tail included
  basis: "month" | "trailing30";
  days: number; // measured days behind the medians
  // stars per 24 h a repo needed to enter the top N that month (median, integer)
  t: Record<BandTier, number>;
}

export interface BandDay {
  day: string;
  n: number; // repos ranked that day
  gains: number[]; // highest first
  hours: number | null; // capture window, when both ends were stamped
}

export const MIN_DAYS = 7;
const DAY = 864e5;
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// One day's cut-offs, per 24 h. A day ranks its repos over the capture window
// (24.1 h one day, 28 h or 20 h another since stamping began on 17-oct-2026),
// so its raw gains are scaled to 24 h to sit on the ladder's UTC days. An
// unstamped window counts as 24 h; a stamped one outside 12-48 h is a broken
// window and the day is left out. So is a day that ranked only part of the
// top (a truncated sweep), whose k-th gain would read low.
function cutoffs(d: BandDay, top: number): Record<BandTier, number> | null {
  if (d.gains.length < 250 || d.n < 0.9 * top) return null;
  if (d.hours != null && !(d.hours >= 12 && d.hours <= 48)) return null;
  const k = d.hours != null ? 24 / d.hours : 1;
  const out = {} as Record<BandTier, number>;
  for (const { key, rank } of BAND_TIERS) out[key] = d.gains[rank - 1] * k;
  return out;
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return iso(Date.UTC(y, m, 0));
}
function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return iso(Date.UTC(y, m, 1)).slice(0, 7);
}

// One band per month from the record's first measured month through
// `through` (today, so the current month has its zone from its first day). A
// month with fewer than MIN_DAYS measured days borrows the 30 days up to its
// last measured day, but only if that day is within a week of BOTH the
// month's start and `through`: a table that stopped updating must leave the
// month WITHOUT a zone (the watchdog's presence.ladder-bands sees it), never
// repaint old cut-offs as this month's.
export function monthlyTierBands(days: BandDay[], opts: { top: number; through: string }): LadderBand[] {
  // one entry per day (the newest copy wins): a repeated day must not count twice
  const byDay = new Map(days.map((d) => [d.day, d]));
  const valid = [...byDay.values()]
    .map((d) => ({ day: d.day, c: cutoffs(d, opts.top) }))
    .filter((d): d is { day: string; c: Record<BandTier, number> } => d.c != null)
    .sort((a, b) => a.day.localeCompare(b.day));
  if (!valid.length) return [];
  const firstDay = valid[0].day;
  const lastMonth = opts.through.slice(0, 7) > valid[valid.length - 1].day.slice(0, 7)
    ? opts.through.slice(0, 7)
    : valid[valid.length - 1].day.slice(0, 7);
  const bands: LadderBand[] = [];
  for (let m = firstDay.slice(0, 7); m <= lastMonth; m = nextMonth(m)) {
    const start = `${m}-01`;
    const end = monthEnd(m);
    const own = valid.filter((d) => d.day >= start && d.day <= end);
    let use = own;
    let basis: LadderBand["basis"] = "month";
    if (own.length < MIN_DAYS) {
      const upto = valid.filter((d) => d.day <= end);
      const last = upto[upto.length - 1];
      if (!last || ms(last.day) < ms(start) - 7 * DAY || ms(opts.through) - ms(last.day) > 7 * DAY) continue;
      use = upto.filter((d) => ms(d.day) > ms(last.day) - 30 * DAY);
      basis = "trailing30";
      if (use.length < MIN_DAYS) continue;
    }
    const t = {} as Record<BandTier, number>;
    for (const { key } of BAND_TIERS) t[key] = Math.round(median(use.map((d) => d.c[key])));
    bands.push({ month: m, from: start < firstDay ? firstDay : start, to: end, basis, days: use.length, t });
  }
  return bands;
}

export const bandFor = (day: string, bands: LadderBand[]): LadderBand | null =>
  bands.find((b) => day >= b.from && day <= b.to) ?? null;

// The zone a day's stars fall in, against its month's cut-offs.
export function zoneOf(stars: number, band: LadderBand): TierKey {
  for (const { key } of BAND_TIERS) if (stars >= band.t[key]) return key;
  return "common";
}

export interface BandArea {
  key: string;
  tier: BandTier;
  x1: string; // category labels of the first and last visible day in the month
  x2: string;
  y1: number;
  y2: number;
}

// The rectangles to draw for the visible window: one per (month, tier),
// clipped to the y-axis top, which re-fits as the ladder pans. That re-fit is
// the point: a quiet month shows green and blue, a wave climbs into purple.
// Rows must be consecutive calendar days with unique labels (DailyLadder's
// view: at most 93 days, so "MM/DD" never repeats).
export function bandAreas(rows: { d: string; label: string }[], bands: LadderBand[], yTop: number): BandArea[] {
  const out: BandArea[] = [];
  for (const b of bands) {
    const inside = rows.filter((r) => r.d >= b.from && r.d <= b.to);
    if (!inside.length) continue;
    BAND_TIERS.forEach(({ key }, i) => {
      const lo = b.t[key];
      const hi = i === 0 ? yTop : b.t[BAND_TIERS[i - 1].key];
      const y1 = Math.min(lo, yTop);
      const y2 = Math.min(hi, yTop);
      if (y2 > y1) out.push({ key: `${b.month}-${key}`, tier: key, x1: inside[0].label, x2: inside[inside.length - 1].label, y1, y2 });
    });
  }
  return out;
}
