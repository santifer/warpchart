// Personal watchlist ("My Constellation"), stored in localStorage so it needs no
// login (honors the "free, no signup" funnel). It is the investment stage of the
// habit loop and the precursor that makes alerts land: you only follow repos you
// pinned. Pure client helpers, each guarded for SSR (no-op on the server).
export interface Watched {
  repo: string;
  lastStars?: number; // stars the last time the constellation page showed it
  lastRank?: number;
  seenAt?: string; // ISO of that last view (for "since your last look")
}

const KEY = "wc_watchlist";
const MAX = 200;

export function getWatchlist(): Watched[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const j = raw ? (JSON.parse(raw) as Watched[]) : [];
    return Array.isArray(j) ? j.filter((w) => w && typeof w.repo === "string") : [];
  } catch {
    return [];
  }
}

function save(list: Watched[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* quota / private mode: ignore */
  }
}

export function isWatched(repo: string): boolean {
  const lk = repo.toLowerCase();
  return getWatchlist().some((w) => w.repo.toLowerCase() === lk);
}

// add or remove; returns the new list
export function toggleWatch(repo: string): Watched[] {
  const lk = repo.toLowerCase();
  const list = getWatchlist();
  const next = list.some((w) => w.repo.toLowerCase() === lk)
    ? list.filter((w) => w.repo.toLowerCase() !== lk)
    : [...list, { repo }];
  save(next);
  return next;
}

// stamp the latest stars/rank so the NEXT visit can show a delta-since-last-look
export function recordSeen(repo: string, stars: number, rank: number): void {
  const lk = repo.toLowerCase();
  const list = getWatchlist();
  const i = list.findIndex((w) => w.repo.toLowerCase() === lk);
  if (i < 0) return;
  list[i] = { ...list[i], lastStars: stars, lastRank: rank, seenAt: new Date().toISOString() };
  save(list);
}
