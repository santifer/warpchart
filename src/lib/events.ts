// Mission log: notable events auto-detected from the hourly history and the
// star timestamps. Pure functions, run at build time.
import type { Snapshot, MissionEvent, DayPoint, Spike } from "./types";
import { fmt, shortName } from "./format";

export function detectEvents(
  history: Snapshot[],
  dailyAll: DayPoint[],
  spikes: Spike[] = []
): MissionEvent[] {
  const events: MissionEvent[] = [];
  if (history.length) {
    events.push({ ts: history[0].ts, kind: "online", text: "telemetry online" });
  }

  // spike forensics: spikes with an identified cause
  for (const s of spikes) {
    const cause = s.causes[0];
    if (!cause) continue;
    events.push({
      ts: s.date + "T12:00:00Z",
      kind: "spike",
      text: `spike of ${fmt(s.stars)} stars · ${cause.title}${cause.points ? ` (${fmt(cause.points)} pts)` : ""}`,
      url: cause.url,
    });
  }

  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1];
    const b = history[i];

    // milestone gate crossings
    const ms = b.milestones ?? a.milestones ?? {};
    for (const mRank of Object.keys(ms).map(Number)) {
      if (a.rank > mRank && b.rank <= mRank) {
        events.push({ ts: b.ts, kind: "gate", text: `entered the worldwide top ${mRank}` });
      }
    }

    // neighbor overtakes: ahead of us in a, behind us in b
    if (a.neighbors?.length && b.neighbors?.length) {
      const prev = new Map(a.neighbors.map((n) => [n.r, n.s]));
      for (const n of b.neighbors) {
        const pS = prev.get(n.r);
        if (pS !== undefined && pS > a.stars && n.s <= b.stars) {
          events.push({
            ts: b.ts,
            kind: "overtake",
            text: `passed ${shortName(n.r)} (${fmt(n.s)} stars)`,
          });
        }
      }
    }
  }

  // daily records over completed days (skip the very first day: everything
  // is a record on day one)
  let best = 0;
  for (let i = 0; i < dailyAll.length - 1; i++) {
    const d = dailyAll[i];
    if (d.c > best) {
      if (best > 0 && i > 0) {
        events.push({
          ts: d.d + "T23:59:59Z",
          kind: "record",
          text: `new daily record: ${fmt(d.c)} stars in one day`,
        });
      }
      best = d.c;
    }
  }

  events.sort((x, y) => (x.ts < y.ts ? -1 : 1));
  return events.slice(-20);
}

// One sober, data-driven line about the latest completed day.
export function captainsLog(dailyAll: DayPoint[], rank: number | null): string | null {
  if (dailyAll.length < 3) return null;
  const yesterday = dailyAll[dailyAll.length - 2];
  const before = dailyAll[dailyAll.length - 3];
  const dayN = dailyAll.length;
  let trend = "";
  if (before.c > 0) {
    const pct = Math.round(((yesterday.c - before.c) / before.c) * 100);
    trend = `, ${pct >= 0 ? "+" : ""}${pct}% vs the day before`;
  }
  return `Day ${dayN}: +${fmt(yesterday.c)} stars${trend}.${rank ? ` Holding rank #${fmt(rank)}.` : ""}`;
}
