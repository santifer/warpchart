// GET /api/v1/dossier?repo=owner/name
//
// THE WHOLE RECORD for one repo: everything the console page shows, in one
// call, so the CLI and any agent can read the same facts the web reader sees
// instead of a subset. Before this existed the CLI could report rank, stars and
// velocity while the page had already grown contributor censuses, DORA lead
// time, clone traffic and npm installs - a terminal user was quietly reading a
// two-months-old version of the product.
//
// GATING IS INHERITED, NEVER REIMPLEMENTED. Each section comes from the same
// loader the page uses, so it carries that loader's rules:
//   registry  - public, always
//   vitals    - loadVitals() returns null for locked repos (owned + paid only)
//   traffic   - ONE aggregate (unique cloners, 30d) for the house repo and
//               nothing for anyone else. The daily series and the referrers
//               live behind /api/traffic + key, ours included since 2026-08-12
//   npm       - public registry data, always
// There is no auth branch in this file on purpose: a second implementation of
// a gate is a second chance to get it wrong.
//
// RANGES. Daily series (clones, npm, the contributor census) accept
// ?since=YYYY-MM-DD, ?until=YYYY-MM-DD or ?range=30d|12w|6m. Trimming happens
// server-side so a terminal never downloads a year to print a week, and every
// trimmed series reports the window it actually covers rather than implying it
// covers everything.
import { NextRequest, NextResponse } from "next/server";
import { repoStats, repoOvertakes, SITE } from "@/lib/api-v1";
import { getCachedDossier } from "@/lib/explorer";
import { loadVitals } from "@/lib/vitals";

export const revalidate = 900;

const BAD = (msg: string, status = 400) =>
  NextResponse.json({ error: msg }, { status, headers: { "Cache-Control": "no-store" } });

// "30d" | "12w" | "6m" | "1y" -> milliseconds. Anything else -> null.
function parseRange(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d+)\s*([dwmy])$/i.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = { d: 864e5, w: 7 * 864e5, m: 30 * 864e5, y: 365 * 864e5 }[m[2].toLowerCase()]!;
  return n * unit;
}

const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

// One window, resolved once and applied to every series so they are directly
// comparable. Explicit since/until win; ?range is relative to the newest day
// present in the data, NOT to now - a series that stopped updating must not
// silently return empty because "the last 30 days" moved past it.
function resolveWindow(req: NextRequest, newestDay: string | null) {
  const p = req.nextUrl.searchParams;
  const since = p.get("since");
  const until = p.get("until");
  const range = parseRange(p.get("range"));
  if (isDay(since) || isDay(until)) {
    return { since: isDay(since) ? since : null, until: isDay(until) ? until : null, kind: "explicit" as const };
  }
  if (range && newestDay) {
    const end = Date.parse(newestDay + "T00:00:00Z");
    return {
      since: new Date(end - range).toISOString().slice(0, 10),
      until: null,
      kind: "range" as const,
    };
  }
  return { since: null, until: null, kind: "full" as const };
}

type Win = ReturnType<typeof resolveWindow>;

// Trim a day-keyed series and report what the trim actually produced. `days`
// is the covered span, so a caller can never mistake a 4-day window for a
// month just because the numbers look small.
function windowed<T extends { day: string }>(rows: T[] | null, w: Win) {
  if (!rows?.length) return null;
  const kept = rows.filter((r) => (!w.since || r.day >= w.since) && (!w.until || r.day <= w.until));
  if (!kept.length) return { from: null, to: null, days: 0, points: [] as T[] };
  return {
    from: kept[0].day,
    to: kept[kept.length - 1].day,
    days: kept.length,
    points: kept,
  };
}

const sum = (rows: { [k: string]: unknown }[] | undefined, k: string) =>
  (rows ?? []).reduce((a, r) => a + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);

export async function GET(req: NextRequest) {
  const repo = (req.nextUrl.searchParams.get("repo") ?? "").trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return BAD("repo must be owner/name");
  const [owner, name] = repo.split("/");


  // registry first: it is the only section that decides whether the repo is
  // something we track at all
  const stats = repoStats(repo);
  if (!stats) return BAD(`${repo} is not in the worldwide top-1000 registry`, 404);

  const [dossier, vitals] = await Promise.all([
    getCachedDossier(owner, name).catch(() => null),
    loadVitals(owner, name).catch(() => null),
  ]);

  // the window anchors on the newest day any series has, so ?range works even
  // when a feed is a few days behind
  // clones are deliberately absent from this list: they are no longer a series
  // here, so they cannot anchor a window
  const newest = [
    dossier?.npmHistory?.at(-1)?.day,
    vitals?.community?.census?.authorsDaily?.at(-1)?.[0],
  ]
    .filter(Boolean)
    .sort()
    .at(-1) as string | undefined;
  const win = resolveWindow(req, newest ?? null);

  const npm = windowed(dossier?.npmHistory ?? null, win);

  // the contributor census arrives as [day, cumulative] pairs; reshape to the
  // same {day,...} row shape so one windowing rule covers every series
  const censusRows = (pairs?: [string, number][]) =>
    pairs?.map(([day, cumulative]) => ({ day, cumulative })) ?? null;
  const cen = vitals?.community?.census;
  const authors = windowed(censusRows(cen?.authorsDaily), win);
  const credited = windowed(censusRows(cen?.creditedDaily), win);

  // NO house branch here any more. fetchDossier decides whether the aggregate
  // exists at all; a second house check in this file would be a second place to
  // get the policy wrong, which is how the old exception survived its premise.
  return NextResponse.json(
    {
      repo: stats.repo,
      url: `${SITE}/r/${stats.repo}`,
      generatedAt: new Date().toISOString(),
      window:
        win.kind === "full"
          ? { kind: "full" }
          : { kind: win.kind, since: win.since, until: win.until },

      registry: {
        rank: stats.rank,
        stars: stats.stars,
        velocityPerDay: stats.velocityPerDay,
        language: stats.language,
        forks: stats.forks,
        nextGate: stats.nextGate ?? null,
        ahead: stats.ahead ?? [],
        behind: stats.behind ?? [],
      },

      // ── engineering health · unlocked repos only ───────────────────────────
      vitals: vitals
        ? {
            verdict: vitals.verdict,
            universe: vitals.universe,
            activityRank: vitals.activity.compositeRank,
            activityPercentile: vitals.activity.compositePct,
            fingerprint: {
              commits: vitals.activity.commitsPct,
              mergedPRs: vitals.activity.prsPct,
              issues: vitals.activity.issuesPct,
              releases: vitals.activity.releasesPct,
              starVelocity: vitals.activity.velocityPct,
            },
            leadTime: vitals.leadTime,
            deploy: vitals.deploy,
            quality: vitals.quality ?? null,
            responsiveness: vitals.responsiveness ?? null,
            automation: vitals.automation ?? null,
            docs: vitals.docs ?? null,
            onboarding: vitals.onboarding ?? null,
            agentReadiness: vitals.agentReadiness ?? null,
            computedAt: vitals.computedAt,
          }
        : { locked: true, reason: "vital signs are computed for owned and paid repos" },

      // ── who builds it ─────────────────────────────────────────────────────
      contributors: vitals?.community
        ? {
            total: vitals.community.contributors,
            // the census reading, which counts differently on purpose; both are
            // reported so a consumer never has to guess which one it holds
            authors: cen?.authors ?? null,
            credited: cen?.credited ?? null,
            aiCoCredits: cen?.aiCoCredits ?? null,
            mergedTotal: vitals.community.mergedTotal ?? null,
            mergedByDistinct: vitals.community.mergedByDistinct,
            maintainers: vitals.community.maintainers,
            top: vitals.community.topContributors,
            busFactor: vitals.community.busFactor ?? null,
            cohorts: vitals.community.cohorts,
            cohortsSource: vitals.community.cohortsSource ?? "pr-sample",
            measuredAt: cen?.measuredAt ?? null,
            series: cen ? { authors, credited } : null,
          }
        : null,

      // ── real usage ────────────────────────────────────────────────────────
      usage: {
        npm: dossier?.npmPkg
          ? {
              package: dossier.npmPkg,
              last30: dossier.npmLast30,
              windowTotal: npm ? sum(npm.points, "d") : null,
              series: npm,
            }
          : null,
        // ONE NUMBER, NO SERIES, NO REFERRERS - for every repo including ours.
        // ?since/?until/?range deliberately do NOT apply here: an aggregate a
        // caller can re-window is a series delivered one request at a time.
        clones:
          dossier?.uniqueCloners30 != null
            ? {
                uniqueCloners30d: dossier.uniqueCloners30,
                // a per-DAY unique count summed over days is not distinct people;
                // saying so here is cheaper than a wrong headline downstream
                note: "per-day uniques summed over 30 closed days; an upper bound on distinct people, not a headcount",
                series: null,
                reason: "daily traffic and referrers require the repo's vault key",
              }
            : {
                locked: true,
                reason: "traffic is private to the repo owner",
              },
        adoption: vitals?.adoption ?? null,
      },

      activity30d: dossier
        ? {
            commits: dossier.commits30,
            prsMerged: dossier.prsMerged30,
            issuesOpened: dossier.issuesOpened30,
            issuesClosed: dossier.issuesClosed30,
            openIssues: dossier.openIssues,
            releases: dossier.releases?.slice(0, 5) ?? [],
          }
        : null,

      overtakes: repoOvertakes(repo),
    },
    { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" } },
  );
}
