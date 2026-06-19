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
  // stars/day from the daily registry diff (collector); colors the whole
  // galaxy with doppler dots at zero API cost. Null/absent = unknown.
  v?: number | null;
  // stable 7-day stars/day (collector/velocity7.mjs, from the rank-history
  // moat). THE canonical velocity: every ETA consumer prefers v7 over the
  // noisy ~1-day v, so projections agree across the product. Absent until the
  // repo has a 7-day baseline recorded.
  v7?: number | null;
}

export interface RouteFile {
  generated_at: string;
  repos: { r: string; s: number; d?: string | null; l?: string | null; f?: number; v?: number | null; v7?: number | null }[];
}

// data/catalog.json, written daily by collector/route-history.mjs from the same
// deep top-N sweep. The source of truth for the rising-by-category directory
// (/c). Carries topics + a daily velocity so the directory can rank by momentum,
// not just stars. Cache-only, zero API cost at request time.
export interface CatalogRepo {
  r: string;
  rank: number;
  s: number;
  v?: number | null; // stars/day (noisy ~1-day rate)
  v7?: number | null; // stable 7-day rate (the canonical velocity), carried from route.json
  l?: string | null; // primary language
  t?: string[]; // GitHub topics
  d?: string | null; // short description
  f?: number; // forks
  c?: string | null; // created_at ISO (for the age-based anti-farm signal)
}

export interface CatalogFile {
  generated_at: string;
  repos: CatalogRepo[];
}

// data/enrichment.json: optional LLM-generated capability tags + one-line
// summary per repo, keyed by lowercased owner/name. Produced offline by
// collector/enrich.mjs via the Claude CLI (not the API), it sharpens the
// natural-language search beyond raw GitHub topics. Absent = search degrades to
// topics + description, which still works.
export interface EnrichmentEntry {
  tags: string[];
  summary: string;
}
export interface EnrichmentFile {
  generated_at: string;
  model?: string;
  entries: Record<string, EnrichmentEntry>;
}

// data/collisions.json, written daily by the collector's collision scanner.
export interface CollisionsFile {
  generated_at: string;
  baseline: { from: string; to: string; days: number };
  collisions: {
    hunter: { r: string; s: number; v: number; l: string | null; rank: number; age?: string | null; x?: string | null };
    victim: { r: string; s: number; v: number; l: string | null; rank: number; age?: string | null; x?: string | null };
    gap: number;
    etaDays: number;
    eta: string;
    sameLang: boolean;
    score: number;
    angles: string[];
  }[];
  entrants: { r: string; s: number; rank: number }[];
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

// Hourly star surge attributed to the traffic source that drove it (collector/
// attribute.mjs). "high" = confirmed by diffing referrer snapshots across the
// surge window; "likely" = the dominant external referrer, no bracketing diff.
export interface SurgeCause {
  type: "referrer";
  domain: string;
  label: string;
  delta: number | null;
  confidence: "high" | "likely";
}

export interface Surge {
  hourStart: string; // ISO, start of the surge hour (UTC)
  stars: number;
  baseline: number;
  cause: SurgeCause | null;
}

export interface AttributionFile {
  generated_at: string;
  repo: string;
  surges: Surge[];
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
