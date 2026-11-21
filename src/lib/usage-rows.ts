// Rows for the dossier's acquisition curve (UsageChart): npm installs and git
// clones stacked by UTC day, daily and cumulative. Pure, so the sums are tested
// without rendering a chart.
//
// The clone channel sums `c` (clone EVENTS), never `u`. `u` is uniques PER DAY:
// one person cloning on ten days adds ten to a running sum of `u`. Summing it
// put a 72-day "92K" on the curve while GitHub's own deduplicated count was
// 29,837 (2026-08-13), and the headline above the chart had already moved to
// `c`. npm downloads are events too, so the stack adds like with like, and the
// curve's clone band ends on the same figure as the CLONES headline.

export interface UsageRow {
  t: number;
  // null past a channel's last published day: unknown, not zero. Recharts
  // breaks the line there instead of drawing a drop to the axis.
  npm: number | null;
  clones: number | null;
  npmCum: number;
  clonesCum: number;
  // null on a day a channel did not record (npm holes): a partial sum is a dip
  total: number | null;
  totalCum: number;
}

export function buildUsageRows(
  npm: { day: string; d: number }[] | null | undefined,
  clones: { day: string; c: number }[] | null | undefined,
): UsageRow[] {
  const hasClones = !!clones && clones.length > 0;
  // npm channel is only real when it has non-zero days; otherwise (npm outage or
  // a clone-only repo) suppress it so we never draw a flat-zero npm series or an
  // empty "since" date on a panel titled "installs, not applause".
  const hasNpm = (npm ?? []).some((p) => p.d > 0);

  // Days npm actually measured. npmHistory arrives with npm's HOLES removed
  // (days npm never recorded and serves as 0, see npm-gaps.ts); a day that has
  // clones but no npm entry is one of them, and must draw as a gap.
  const npmDays = new Set((npm ?? []).map((p) => p.day));
  const byDay = new Map<string, { npm: number; clones: number }>();
  for (const p of npm ?? []) {
    const e = byDay.get(p.day) ?? { npm: 0, clones: 0 };
    e.npm += p.d;
    byDay.set(p.day, e);
  }
  for (const p of clones ?? []) {
    const e = byDay.get(p.day) ?? { npm: 0, clones: 0 };
    e.clones += p.c;
    byDay.set(p.day, e);
  }
  const days = [...byDay.keys()].sort();
  if (days.length < 2) return [];
  // Channels publish at different speeds: npm's daily series lands 3-4 days
  // after GitHub's traffic API. Past a channel's last real day the value is
  // UNKNOWN, not zero - drawing it as zero made npm look like it collapsed.
  const lastNpmDay = (npm ?? []).reduce<string | null>((m, p) => (!m || p.day > m ? p.day : m), null);
  const lastCloneDay = (clones ?? []).reduce<string | null>((m, p) => (!m || p.day > m ? p.day : m), null);
  // The CURVE stops on the last day every active channel has closed, so it
  // keeps a clean common horizon instead of a stretch where one band ends
  // mid-plot and reads as a glitch. This is a DRAWING decision only: the
  // panel's totals above run to each channel's own latest day and name it
  // ("through Jul 27"). That separation is the fix - clipping the DATA to the
  // slowest channel was throwing away real clone days, which is what made the
  // panel show 2026-07-24 while GitHub already had 07-27.
  const chartEnd =
    lastNpmDay && lastCloneDay && hasNpm && hasClones
      ? [lastNpmDay, lastCloneDay].sort()[0]
      : (lastCloneDay ?? lastNpmDay);
  let cn = 0;
  let cc = 0;
  return days.filter((day) => !chartEnd || day <= chartEnd).map((day) => {
    const e = byDay.get(day)!;
    const npmKnown = lastNpmDay !== null && day <= lastNpmDay && npmDays.has(day);
    const npmHole = hasNpm && lastNpmDay !== null && day <= lastNpmDay && !npmDays.has(day);
    const cloneKnown = lastCloneDay !== null && day <= lastCloneDay;
    if (npmKnown) cn += e.npm;
    if (cloneKnown) cc += e.clones;
    return {
      t: Date.parse(`${day}T00:00:00Z`),
      // DAILY: a day with no published figure is a gap, not a zero.
      npm: npmKnown ? e.npm : null,
      clones: cloneKnown ? e.clones : null,
      // CUMULATIVE: hold the last known total. The areas are stacked, so a null
      // would drop the band above it to the floor; and "N installs so far"
      // stays true when no newer figure has been published - it just stops
      // growing, which is exactly what we know.
      npmCum: cn,
      clonesCum: cc,
      total: npmHole ? null : (npmKnown ? e.npm : 0) + (cloneKnown ? e.clones : 0),
      totalCum: cn + cc,
    };
  });
}
