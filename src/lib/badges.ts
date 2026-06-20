// Repo "classifications": the gamification layer. Astronomy-flavored badges
// earned from VERIFIABLE, size-ORTHOGONAL signals, so they differentiate repos
// even at the core (a magnitude badge like "top 100" saturates — every giant
// has it; growth SHAPE does not). One CLASS (the dominant growth profile) plus
// additive DESIGNATIONS. Gates are calibrated against the live ~3000-repo
// catalog to ~1-2% rarity each. Pure + cache-only; classifications are earned,
// never bought (that integrity is what makes them worth displaying).
import { loadCatalog } from "./history";
import type { CatalogRepo } from "./types";
import { canonicalVel0 } from "./velocity";

export interface Badge {
  key: string;
  label: string;
  glyph: string;
  kind: "class" | "designation";
  blurb: string; // what the classification means
  detail: string; // the exact data that earned it (shown on hover)
  active?: boolean; // false = earned in the past, no longer met (sticky history)
  earnedAt?: string | null; // ISO date the badge was first earned, if known
}

export interface RepoBadges {
  klass: Badge | null;
  designations: Badge[];
}

// Static presentation metadata per badge key, so a STICKY badge (earned then
// lost) can be reconstructed without re-running the gates it no longer passes.
const BADGE_META: Record<string, Pick<Badge, "label" | "glyph" | "kind" | "blurb">> = {
  comet: { label: "COMET", glyph: "☄", kind: "designation", blurb: "Surging right now — adding stars faster than ~98% of every repo Warpchart tracks." },
  meteor: { label: "METEOR", glyph: "✶", kind: "class", blurb: "Explosive early growth — a young project accruing stars faster than almost any other its age." },
  "blue-giant": { label: "BLUE GIANT", glyph: "◉", kind: "class", blurb: "Elite scale, still burning hot — top-100 worldwide and among the fastest-growing of its peers." },
  "main-sequence": { label: "MAIN SEQUENCE", glyph: "✦", kind: "class", blurb: "A venerable cornerstone — a top-100 project that has burned steadily for many years." },
  foundational: { label: "FOUNDATIONAL", glyph: "⬡", kind: "designation", blurb: "Infrastructure others build on — forked far more than its peers, the mark of a true dependency." },
};

// Sticky store shape: repo (lowercased) -> badge key -> ISO date first earned.
export type EarnedBadges = Record<string, Record<string, string>>;

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
  cometV: number; // p98 RECENT stars/day across the whole catalog (live momentum)
  forkByDecile: { maxStars: number; gate: number }[]; // p95 fork-ratio per star decile
}

function computeThresholds(repos: CatalogRepo[], now: number): Thresholds {
  const young = repos.filter((r) => ageDaysOf(r, now) < 730 && r.rank <= 1000);
  const meteorSpd = pctile(young.map((r) => r.s / ageDaysOf(r, now)), 0.85);
  const top1k = repos.filter((r) => r.rank <= 1000);
  const blueV = pctile(top1k.map((r) => canonicalVel0(r)), 0.9);
  // COMET is size-blind: the top 2% of velocity across the whole catalog, so a
  // surging mid-pack repo earns it without being a giant. Gated on the CANONICAL
  // 7-day rate (velocity.ts), not the noisy ~1-day v, so the public sigil cannot
  // be won or lost on a single-day burst (the integrity the badge promises).
  const cometV = pctile(repos.map(canonicalVel0).filter((v) => v > 0), 0.98);
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
  return { meteorSpd, blueV, cometV, forkByDecile };
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// Classify ONE catalog repo against pre-computed cohort thresholds. Split out
// so the single-repo lookup (repoBadges) and the whole-registry batch
// (classifiedRegistry) share identical gate logic — and the batch computes the
// thresholds once instead of re-sorting the catalog per repo.
function classify(me: CatalogRepo, T: Thresholds, now: number): RepoBadges {
  const ageDays = ageDaysOf(me, now);
  const yrs = ageDays / 365;
  const spd = me.s / ageDays;
  const v = canonicalVel0(me); // canonical 7-day rate (velocity.ts), matches the gates above
  const fr = (me.f ?? 0) / Math.max(1, me.s);

  // CLASS — at most one, priority METEOR > BLUE GIANT > MAIN SEQUENCE.
  let klass: Badge | null = null;
  if (ageDays < 730 && me.rank <= 1000 && spd >= T.meteorSpd) {
    klass = {
      key: "meteor",
      label: "METEOR",
      glyph: "✶",
      kind: "class",
      blurb: "Explosive early growth — a young project accruing stars faster than almost any other its age.",
      detail: `${fmt(Math.round(spd))} stars/day on average since it was created ${yrs.toFixed(1)} years ago — top 15% of all repos under two years old.`,
    };
  } else if (me.rank <= 100 && v >= T.blueV) {
    klass = {
      key: "blue-giant",
      label: "BLUE GIANT",
      glyph: "◉",
      kind: "class",
      blurb: "Elite scale, still burning hot — top-100 worldwide and among the fastest-growing of its peers.",
      detail: `#${fmt(me.rank)} worldwide and still adding ${fmt(Math.round(v))} stars/day — top 10% velocity of the entire top 1,000.`,
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

  // DESIGNATIONS — additive honors. COMET goes first so it is the PRIMARY sigil
  // for a repo with no class (a surging mid-pack repo like headroom): recent
  // momentum, size-blind. It reads the canonical velocity (7-day v7, ~1-day v
  // fallback), so it tracks the present, not the lifetime average METEOR uses.
  const designations: Badge[] = [];
  if (v > 0 && v >= T.cometV) {
    designations.push({
      key: "comet",
      label: "COMET",
      glyph: "☄",
      kind: "designation",
      blurb: "Surging right now — adding stars faster than ~98% of every repo Warpchart tracks.",
      detail: `Adding ${fmt(Math.round(v))} stars/day (trailing pace, up to 7 days) — top 2% of every tracked repo, regardless of size.`,
    });
  }
  const decile = T.forkByDecile.find((d) => me.s <= d.maxStars) ?? T.forkByDecile[T.forkByDecile.length - 1];
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
  return classify(me, computeThresholds(repos, now), now);
}

export interface ClassifiedRepo {
  r: string;
  key: string;
  label: string;
  kind: "class" | "designation";
}

// The PRIMARY badge (class, else first designation) of every classified repo in
// the catalog, computed in a SINGLE pass (thresholds once). Powers the star
// chart's per-node sigils from one cache-only response — no fetch per node.
// Only the ~5% of repos that earned a badge are returned, so the payload is tiny.
export function classifiedRegistry(): ClassifiedRepo[] {
  const repos = loadCatalog()?.repos ?? [];
  if (!repos.length) return [];
  const now = Date.now();
  const T = computeThresholds(repos, now);
  const out: ClassifiedRepo[] = [];
  for (const me of repos) {
    const b = classify(me, T, now);
    const primary = b.klass ?? b.designations[0] ?? null;
    if (primary) out.push({ r: me.r, key: primary.key, label: primary.label, kind: primary.kind });
  }
  return out;
}

// Every (repo, badgeKey) currently MET across the catalog — class AND each
// designation, not just the primary. The /api/cron/badges job unions this into
// the sticky earned-badges store so nothing earned is ever lost.
export function allActiveBadges(): { r: string; key: string }[] {
  const repos = loadCatalog()?.repos ?? [];
  if (!repos.length) return [];
  const now = Date.now();
  const T = computeThresholds(repos, now);
  const out: { r: string; key: string }[] = [];
  for (const me of repos) {
    const b = classify(me, T, now);
    if (b.klass) out.push({ r: me.r, key: b.klass.key });
    for (const d of b.designations) out.push({ r: me.r, key: d.key });
  }
  return out;
}

// repoBadges + the sticky layer. A badge earned in the past is KEPT once a repo
// stops meeting it, marked active:false so the UI can dim it ("earned, no longer
// active") — sticky without lying about the present. `earned` is loaded by the
// caller (loadEarnedBadges, async/Blob) so this stays sync + pure.
export function repoBadgesWithHistory(repoName: string, earned: EarnedBadges): RepoBadges {
  const live = repoBadges(repoName);
  const mine = earned[repoName.toLowerCase()] ?? {};
  const stamp = (b: Badge): Badge => ({ ...b, active: true, earnedAt: mine[b.key] ?? null });
  const klass = live.klass ? stamp(live.klass) : null;
  const designations = live.designations.map(stamp);
  const activeKeys = new Set<string>([...(klass ? [klass.key] : []), ...designations.map((d) => d.key)]);
  const historical: Badge[] = Object.entries(mine)
    .filter(([key]) => !activeKeys.has(key) && BADGE_META[key])
    .sort((a, b) => (a[1] < b[1] ? 1 : -1)) // most recently earned first
    .map(([key, date]) => ({
      ...BADGE_META[key],
      key,
      active: false,
      earnedAt: date,
      detail: `Earned ${date} · no longer active, kept as a record.`,
    }));
  return { klass, designations: [...designations, ...historical] };
}
