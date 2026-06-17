// Repo "classifications": the gamification layer. Astronomy-flavored badges
// earned from VERIFIABLE, size-ORTHOGONAL signals, so they differentiate repos
// even at the core (a magnitude badge like "top 100" saturates — every giant
// has it; growth SHAPE does not). One CLASS (the dominant growth profile) plus
// additive DESIGNATIONS. Gates are calibrated against the live ~3000-repo
// catalog to ~1-2% rarity each. Pure + cache-only; classifications are earned,
// never bought (that integrity is what makes them worth displaying).
import { loadCatalog } from "./history";
import type { CatalogRepo } from "./types";

export interface Badge {
  key: string;
  label: string;
  glyph: string;
  kind: "class" | "designation";
  blurb: string; // what the classification means
  detail: string; // the exact data that earned it (shown on hover)
}

export interface RepoBadges {
  klass: Badge | null;
  designations: Badge[];
}

const DAY = 86400e3;
const INFRA = /(library|framework|sdk|api|cli|database|runtime|kernel|compiler|orm|driver)/i;

function pctile(arr: number[], p: number): number {
  if (!arr.length) return Infinity;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
}

// NaN when the created date is missing/invalid, which naturally disqualifies the
// age-based classes (NaN < 730 and NaN > 8 are both false) without false positives.
const ageDaysOf = (r: CatalogRepo, now: number): number => {
  const t = r.c ? Date.parse(r.c) : NaN;
  return Number.isFinite(t) ? Math.max(1, (now - t) / DAY) : NaN;
};

interface Thresholds {
  meteorSpd: number; // top-15% lifetime stars/day among young (<2y) + top-1000 repos
  blueV: number; // p90 velocity of the top-1000
  forkByDecile: { maxStars: number; gate: number }[]; // p95 fork-ratio per star decile
}

function computeThresholds(repos: CatalogRepo[], now: number): Thresholds {
  const young = repos.filter((r) => ageDaysOf(r, now) < 730 && r.rank <= 1000);
  const meteorSpd = pctile(young.map((r) => r.s / ageDaysOf(r, now)), 0.85);
  const top1k = repos.filter((r) => r.rank <= 1000);
  const blueV = pctile(top1k.map((r) => Math.max(0, r.v ?? 0)), 0.9);
  const byStars = [...repos].sort((a, b) => a.s - b.s);
  const dec = Math.max(1, Math.ceil(byStars.length / 10));
  const forkByDecile: Thresholds["forkByDecile"] = [];
  for (let i = 0; i < 10; i++) {
    const band = byStars.slice(i * dec, (i + 1) * dec);
    if (!band.length) continue;
    forkByDecile.push({
      maxStars: band[band.length - 1].s,
      gate: pctile(band.map((r) => (r.f ?? 0) / Math.max(1, r.s)), 0.95),
    });
  }
  return { meteorSpd, blueV, forkByDecile };
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// Classify a repo from the catalog. Returns no badges for repos outside the
// catalog (we cannot place them in a cohort), which is the honest neutral state.
export function repoBadges(repoName: string): RepoBadges {
  const repos = loadCatalog()?.repos ?? [];
  if (!repos.length) return { klass: null, designations: [] };
  const lower = repoName.toLowerCase();
  let me = repos.find((p) => p.r.toLowerCase() === lower);
  if (!me) {
    const n = lower.split("/")[1] ?? "";
    if (n) me = repos.find((p) => p.r.toLowerCase().split("/")[1] === n);
  }
  if (!me) return { klass: null, designations: [] };

  const now = Date.now();
  const T = computeThresholds(repos, now);
  const ageDays = ageDaysOf(me, now);
  const yrs = ageDays / 365;
  const spd = me.s / ageDays;
  const v = Math.max(0, me.v ?? 0);
  const fr = (me.f ?? 0) / Math.max(1, me.s);

  // CLASS — at most one, priority METEOR > BLUE GIANT > MAIN SEQUENCE.
  let klass: Badge | null = null;
  if (ageDays < 730 && me.rank <= 1000 && spd >= T.meteorSpd) {
    klass = {
      key: "meteor",
      label: "METEOR",
      glyph: "☄",
      kind: "class",
      blurb: "Explosive early growth — a young project accruing stars faster than almost any other its age.",
      detail: `${fmt(spd)} stars/day on average since it was created ${yrs.toFixed(1)} years ago — top 15% of all repos under two years old.`,
    };
  } else if (me.rank <= 100 && v >= T.blueV) {
    klass = {
      key: "blue-giant",
      label: "BLUE GIANT",
      glyph: "◉",
      kind: "class",
      blurb: "Elite scale, still burning hot — top-100 worldwide and among the fastest-growing of its peers.",
      detail: `#${fmt(me.rank)} worldwide and still adding ${fmt(v)} stars/day — top 10% velocity of the entire top 1,000.`,
    };
  } else if (yrs > 8 && me.rank <= 100) {
    klass = {
      key: "main-sequence",
      label: "MAIN SEQUENCE",
      glyph: "✦",
      kind: "class",
      blurb: "A venerable cornerstone — a top-100 project that has burned steadily for many years.",
      detail: `#${fmt(me.rank)} worldwide, ${yrs.toFixed(0)} years old and still in the core.`,
    };
  }

  // DESIGNATIONS — additive honors.
  const designations: Badge[] = [];
  const decile = T.forkByDecile.find((d) => me!.s <= d.maxStars) ?? T.forkByDecile[T.forkByDecile.length - 1];
  const infra = (me.t ?? []).some((t) => INFRA.test(t)) || INFRA.test(me.d ?? "");
  if (decile && fr >= decile.gate && infra) {
    designations.push({
      key: "foundational",
      label: "FOUNDATIONAL",
      glyph: "⬡",
      kind: "designation",
      blurb: "Infrastructure others build on — forked far more than its peers, the mark of a true dependency.",
      detail: `${(fr * 100).toFixed(0)}% fork-to-star ratio — top 5% for its size — with a library/framework focus.`,
    });
  }

  return { klass, designations };
}
