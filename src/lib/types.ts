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
}

export interface RouteFile {
  generated_at: string;
  repos: { r: string; s: number; d?: string | null; l?: string | null }[];
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

export interface HourPoint { t: number; c: number } // t = UTC hour start (ms)
export interface DayPoint { d: string; c: number } // d = YYYY-MM-DD (UTC)
export interface CumPoint { t: number; total: number }
export interface RankPoint { t: number; rank: number }
export interface FloorPoint { d: string; perHour: number }
