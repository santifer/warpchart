export interface Neighbor {
  r: string; // full name owner/name
  s: number; // stars
  v: number; // stars/day over its last 100 stars
  d?: string | null; // description, trimmed
  l?: string | null; // primary language
}

export interface Apex {
  r: string;
  s: number;
}

// A worldwide top-N repo used as a dot/landmark on the route band.
export interface RouteRepo {
  r: string;
  s: number;
  rank: number;
  d?: string | null;
  l?: string | null;
  f?: number; // forks
}

export interface RouteFile {
  generated_at: string;
  repos: { r: string; s: number; d?: string | null; l?: string | null; f?: number }[];
}

export interface SpikeCause {
  type: "hn" | "reddit" | "release";
  title: string;
  url: string;
  points: number | null;
}

export interface Spike {
  date: string; // YYYY-MM-DD
  stars: number;
  causes: SpikeCause[];
}

export interface ForensicsFile {
  generated_at: string;
  spikes: Spike[];
}

export interface Snapshot {
  ts: string;
  stars: number;
  rank: number;
  milestones: Record<string, number> | null;
  neighbors: Neighbor[] | null;
  apex?: Apex | null;
  meta?: { new_ts?: number; pages?: number; partial?: boolean; bootstrap?: boolean };
}

export interface RepoMetaFile {
  repo: string;
  owner: string;
  name: string;
  description: string | null;
  created_at: string;
  avatar_url: string;
  homepage: string | null;
  language: string | null;
  forks: number;
  bootstrapped_at?: string;
}

export interface MilestonesFile {
  measured_at: string;
  rank: number;
  milestones: Record<string, number>;
}

export interface MissionEvent {
  ts: string;
  kind: "gate" | "overtake" | "record" | "online" | "spike";
  text: string;
  url?: string | null;
}

// Everything GalacticChart needs, decoupled from the bundle + live layer so
// the explorer (/r/owner/name) can feed it static per-request data.
export interface ChartInputs {
  repo: string;
  stars: number;
  rank: number | null;
  v7d: number;
  neighbors: Neighbor[];
  // `at` is the DRAWN position: the midpoint between the stars of rank N
  // and rank N-1, so the gate reads as a doorway BETWEEN both ships instead
  // of sitting on top of the rank-N repo. `threshold` keeps the semantics
  // (gap and eta math).
  milestones: { rank: number; threshold: number; drift: number | null; at?: number | null }[];
  apex: Apex | null;
  routeDots: RouteRepo[];
  routeLandmarks: RouteRepo[];
  routeAll: RouteRepo[];
  nowMs: number;
  // The instance's own tracked repo, shown as a HOME marker when this chart
  // renders some other repo (explorer pages). Null when you ARE home.
  home?: { r: string; s: number } | null;
}

export interface HourPoint { t: number; c: number } // t = UTC hour start (ms)
export interface DayPoint { d: string; c: number } // d = YYYY-MM-DD (UTC)
export interface CumPoint { t: number; total: number }
export interface RankPoint { t: number; rank: number }
export interface FloorPoint { d: string; perHour: number }
