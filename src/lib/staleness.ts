// How old the collector's last snapshot may get before it is a problem.
//
// The workflow is declared every 2 h, but GitHub throttles cron on public
// repos: measured over a week (26-sep-2026) the real gap between runs had a
// median of ~5 h and a normal worst of ~8 h, while the real incidents of the
// month were holes of 13 h and 25 h. The old 3 h line fired on 24 of 28 normal
// gaps, so the phone got "collector quiet" almost every cycle: an alarm people
// learn to ignore. 10 h sits above every normal gap and below every real one.
export const COLLECTOR_STALE_H = 10;

// The phone is paged once at each of these ages (minutes), inside one cron
// window of the 30-minute Vercel cron, so a long outage pages 3 times, not 48.
export const PAGE_MARKS_MIN = [COLLECTOR_STALE_H * 60, 16 * 60, 24 * 60];
const WINDOW_MIN = 31; // slightly over the cron cadence so a mark never slips

export function pageMark(ageMin: number): number | null {
  return PAGE_MARKS_MIN.find((m) => ageMin >= m && ageMin < m + WINDOW_MIN) ?? null;
}
