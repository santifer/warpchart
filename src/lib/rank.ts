// ONE definition of worldwide rank: 1 + the number of repos with strictly MORE
// stars. GitHub's search answers it live (worldwideRank: `stars:>N`), the
// collector asks the same question (countAbove + 1), and the registry answers
// it offline by COUNTING, never by array position: the registry reorders once
// a day while its star counts refresh every 2 h, so an index is last night's
// position wearing this morning's stars ("65,139 stars · #307" on the morning
// that count meant #301). Twin of collector/rules.mjs (src/lib/parity.test.ts).
export const rankQuery = (stars: number): string => `stars:>${stars}`;

export const rankByStars = (repos: readonly { s: number }[], stars: number): number =>
  repos.reduce((n, p) => (p.s > stars ? n + 1 : n), 1);

// The registry in rank order, each entry with its counted rank. Sorted by the
// stars it carries NOW (stable, so ties keep the registry's order), so a slice
// by position (neighbors, the repo holding gate N) agrees with the rank shown.
export function rankedRegistry<T extends { s: number }>(repos: readonly T[]): (T & { rank: number })[] {
  const sorted = [...repos].sort((a, b) => b.s - a.s);
  let rank = 1;
  return sorted.map((p, i) => {
    if (i > 0 && p.s < sorted[i - 1].s) rank = i + 1;
    return { ...p, rank };
  });
}
