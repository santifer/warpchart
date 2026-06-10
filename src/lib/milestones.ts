// Next round-number rank milestones below the current rank.
// rank 409 -> [400, 300, 200, 100]; rank 101 -> [100, 90, 80, 70].
// Mirror of the same helper in collector/lib.mjs.
export function nextMilestones(rank: number, count = 4): number[] {
  if (!Number.isFinite(rank) || rank <= 1) return [];
  const out: number[] = [];
  let unit = Math.pow(10, Math.floor(Math.log10(rank - 1)));
  let m = Math.floor((rank - 1) / unit) * unit;
  while (out.length < count && m >= 1) {
    out.push(m);
    if (m - unit < 1 && unit > 1) unit = unit / 10;
    m -= unit;
  }
  return out;
}
