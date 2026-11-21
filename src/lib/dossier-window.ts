// ?since / ?until / ?range for the dossier's daily series (/api/v1/dossier).
// Pure, so the window can be tested without a request.

// "30d" | "12w" | "6m" | "1y" -> milliseconds. Anything else -> null.
export function parseRange(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d+)\s*([dwmy])$/i.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = { d: 864e5, w: 7 * 864e5, m: 30 * 864e5, y: 365 * 864e5 }[m[2].toLowerCase()]!;
  return n * unit;
}

const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

// One window, resolved once and applied to every series so they are directly
// comparable. Explicit since/until win; ?range is relative to the newest day
// present in the data, NOT to now - a series that stopped updating must not
// silently return empty because "the last 30 days" moved past it.
export function resolveWindow(p: URLSearchParams, newestDay: string | null) {
  const since = p.get("since");
  const until = p.get("until");
  const range = parseRange(p.get("range"));
  if (isDay(since) || isDay(until)) {
    return { since: isDay(since) ? since : null, until: isDay(until) ? until : null, kind: "explicit" as const };
  }
  if (range && newestDay) {
    // both ends are inclusive days: ?range=30d is the newest day and the 29
    // before it. `end - range` started a 31st day back.
    const end = Date.parse(newestDay + "T00:00:00Z");
    return {
      since: new Date(end - range + 864e5).toISOString().slice(0, 10),
      until: null,
      kind: "range" as const,
    };
  }
  return { since: null, until: null, kind: "full" as const };
}

export type Win = ReturnType<typeof resolveWindow>;

// Trim a day-keyed series and report what the trim actually produced. `days`
// is the covered span, so a caller can never mistake a 4-day window for a
// month just because the numbers look small.
export function windowed<T extends { day: string }>(rows: T[] | null, w: Win) {
  if (!rows?.length) return null;
  const kept = rows.filter((r) => (!w.since || r.day >= w.since) && (!w.until || r.day <= w.until));
  if (!kept.length) return { from: null, to: null, days: 0, points: [] as T[] };
  return {
    from: kept[0].day,
    to: kept[kept.length - 1].day,
    days: kept.length,
    points: kept,
  };
}
