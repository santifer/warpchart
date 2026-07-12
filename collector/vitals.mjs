// VITAL SIGNS collector — the derived-intelligence moat behind the panel of the
// same name. Star count is free from GitHub; "is this repo actually alive vs the
// 1000 most-starred" is not. Two phases:
//
//   PHASE A (the moat): a fixed top-N reference DISTRIBUTION of development
//   activity (commits / merged PRs / closed issues, 30d). One aliased GraphQL
//   call per repo, bounded and resumable, idempotent per day. Written to
//   vitals/_dist.json. This is the expensive, defensible part: nobody else keeps
//   a daily activity distribution over the top of GitHub.
//
//   PHASE B (per unlocked repo): full vitals for the OWNED repos (career-ops,
//   free forever) and PAID tenants — light activity + DORA lead time (paginated
//   merged PRs, median/p90/tier) + clone-conversion (from the Traffic Vault) +
//   percentiles against _dist.json + an ALIVE / MONUMENT verdict. Written to
//   vitals/{owner}--{name}.json. Presence of that file IS the unlock gate the
//   loader (src/lib/vitals.ts) reads — a paid repo lights up with no redeploy.
//
// Runs after collect.mjs (needs route.json) and before sync-to-blob. Wrapped so
// it can NEVER break the collect run. Cache-only contract preserved: all GitHub
// work happens HERE, page views only read the Blob.
//
// Usage: GITHUB_TOKEN=... BLOB_READ_WRITE_TOKEN=... node collector/vitals.mjs
//   env knobs: VITALS_UNIVERSE (default 1000) · VITALS_DIST_MAX (per-run cap on
//   distribution refreshes, default 1000) · VITALS_PACE_MS (gap between calls)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { get, put } from "@vercel/blob";
import { DATA_DIR, graphql, sleep, token, readConfig } from "./lib.mjs";

token(); // GitHub token: fail fast
const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
if (!blobToken) {
  console.log("[vitals] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

const UNIVERSE = Math.max(50, Number(process.env.VITALS_UNIVERSE || 1000));
const DIST_MAX = Math.max(1, Number(process.env.VITALS_DIST_MAX || 1000));
const PACE_MS = Math.max(0, Number(process.env.VITALS_PACE_MS || 700));
const DAY = 864e5;
const today = new Date().toISOString().slice(0, 10);

const config = readConfig();
const OWNED = ((config.owned_by ?? [config.repo.split("/")[0]]) || []).map((o) => o.toLowerCase());
const blobKey = (repo) => `vitals/${repo.toLowerCase().replace("/", "--")}.json`;

async function readBlob(key) {
  try {
    const res = await get(key, { access: "private", token: blobToken, useCache: false });
    if (res?.statusCode === 200 && res.stream) return JSON.parse(await new Response(res.stream).text());
  } catch {
    /* missing or transient */
  }
  return null;
}
async function writeBlob(key, obj) {
  await put(key, JSON.stringify(obj), {
    access: "private",
    token: blobToken,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

// GraphQL with backoff on rate-limit / transient errors — the top-1000
// distribution sweep makes ~1000 calls; a secondary-rate-limit blip must retry,
// not silently drop a repo from the distribution.
async function gqlRetry(query, vars, tries = 4) {
  let delay = 1500;
  for (let i = 0; i < tries; i++) {
    try {
      return await graphql(query, vars);
    } catch (e) {
      const msg = String(e?.message || e);
      const transient = /rate limit|secondary|abuse|403|429|500|502|503|timeout/i.test(msg);
      if (i === tries - 1 || !transient) throw e;
      await sleep(delay);
      delay *= 2;
    }
  }
}

// ---- distribution activity: NON-SEARCH metrics only (fast over top-1000) ----
// The GraphQL search connection is capped at 30/min, so a 1000-repo sweep using
// search would take ~1h. The reference distribution therefore uses only metrics
// that come from the plain repository query (no search): 30d commits (default
// branch history) and 90d releases. Velocity (v7) is free from route.json. This
// keeps Phase A at ~1 point/repo, no search limit, ~3-4 min for the full top-N.
async function distActivity(repo) {
  const [owner, name] = repo.split("/");
  const since = new Date(Date.now() - 30 * DAY);
  const d = await gqlRetry(
    `query($owner:String!,$name:String!,$since:GitTimestamp!){
      repository(owner:$owner,name:$name){
        defaultBranchRef{ target{ ... on Commit{ history(since:$since){ totalCount } } } }
        releases(first:40, orderBy:{field:CREATED_AT,direction:DESC}){ nodes{ publishedAt isPrerelease } }
      }
    }`,
    { owner, name, since: since.toISOString() },
  );
  const commits30 = d.repository?.defaultBranchRef?.target?.history?.totalCount ?? 0;
  const cutoff = Date.now() - 90 * DAY;
  const releases90 = (d.repository?.releases?.nodes ?? []).filter(
    (r) => r.publishedAt && !r.isPrerelease && Date.parse(r.publishedAt) >= cutoff,
  ).length;
  return { commits30, releases90 };
}

// ---- one aliased call: 30d commits/PRs/issues + recent releases (per-repo) ---
async function lightActivity(repo) {
  const [owner, name] = repo.split("/");
  const since = new Date(Date.now() - 30 * DAY);
  const day = since.toISOString().slice(0, 10);
  const d = await gqlRetry(
    `query($owner:String!,$name:String!,$qc:String!,$qm:String!,$since:GitTimestamp!){
      qc: search(query:$qc, type:ISSUE){ issueCount }
      qm: search(query:$qm, type:ISSUE){ issueCount }
      repository(owner:$owner,name:$name){
        defaultBranchRef{ target{ ... on Commit{ history(since:$since){ totalCount } } } }
        releases(first:20, orderBy:{field:CREATED_AT,direction:DESC}){ nodes{ publishedAt isPrerelease } }
      }
    }`,
    {
      owner,
      name,
      qc: `repo:${repo} type:issue closed:>${day}`,
      qm: `repo:${repo} type:pr merged:>${day}`,
      since: since.toISOString(),
    },
  );
  // PRs merged in 30d = the merged-PR search. Closed issues in 30d = the issue
  // search MINUS merged PRs is not needed; we count issues and PRs separately.
  const prs30 = d.qm?.issueCount ?? 0;
  const issues30 = d.qc?.issueCount ?? 0;
  const commits30 = d.repository?.defaultBranchRef?.target?.history?.totalCount ?? 0;
  const cutoff = Date.now() - 90 * DAY;
  const releases90 = (d.repository?.releases?.nodes ?? []).filter(
    (r) => r.publishedAt && !r.isPrerelease && Date.parse(r.publishedAt) >= cutoff,
  ).length;
  return { commits30, prs30, issues30, releases90 };
}

// ---- one merged-PR sweep -> DORA lead time + the human engine ---------------
// Paginate merged PRs once, gathering createdAt/mergedAt (lead time), author
// (contributors + cohorts) and mergedBy (the maintainer gate). Two derived
// panels for the price of one pagination.
const BOTS = new Set(["github-actions", "renovate", "dependabot", "renovate-bot", "codecov"]);
const isBot = (l) => !l || BOTS.has(l.toLowerCase()) || l.toLowerCase().endsWith("[bot]");

async function prAnalysis(repo, want = 500) {
  const [owner, name] = repo.split("/");
  const hrs = [];
  const authorCount = new Map();
  const mergers = new Set();
  const monthAuthors = new Map(); // "YYYY-MM" -> Set(login)
  let cursor = null;
  while (hrs.length < want) {
    const d = await gqlRetry(
      `query($owner:String!,$name:String!,$after:String){
        repository(owner:$owner,name:$name){
          pullRequests(states:MERGED, first:100, orderBy:{field:CREATED_AT,direction:DESC}, after:$after){
            pageInfo{ hasNextPage endCursor }
            nodes{ createdAt mergedAt author{ login } mergedBy{ login } }
          }
        }
      }`,
      { owner, name, after: cursor },
    );
    const pr = d.repository?.pullRequests;
    if (!pr) break;
    for (const n of pr.nodes) {
      if (!n.createdAt || !n.mergedAt) continue;
      const h = (Date.parse(n.mergedAt) - Date.parse(n.createdAt)) / 36e5;
      if (h >= 0) hrs.push(h);
      const au = n.author?.login;
      if (au) {
        authorCount.set(au, (authorCount.get(au) || 0) + 1);
        const m = n.createdAt.slice(0, 7);
        if (!monthAuthors.has(m)) monthAuthors.set(m, new Set());
        monthAuthors.get(m).add(au);
      }
      if (n.mergedBy?.login) mergers.add(n.mergedBy.login);
    }
    if (!pr.pageInfo.hasNextPage) break;
    cursor = pr.pageInfo.endCursor;
    if (PACE_MS) await sleep(PACE_MS);
  }

  let leadTime = null;
  if (hrs.length) {
    hrs.sort((a, b) => a - b);
    const q = (p) => {
      const k = (hrs.length - 1) * p;
      const f = Math.floor(k);
      return hrs[f] + (hrs[Math.min(f + 1, hrs.length - 1)] - hrs[f]) * (k - f);
    };
    const median = q(0.5);
    leadTime = {
      medianH: Math.round(median * 10) / 10,
      p90H: Math.round(q(0.9) * 10) / 10,
      tier: median < 24 ? "Elite" : median < 168 ? "High" : median < 720 ? "Medium" : "Low",
      sample: hrs.length,
      pctUnder24h: Math.round((hrs.filter((h) => h <= 24).length / hrs.length) * 100),
      pctUnder7d: Math.round((hrs.filter((h) => h <= 168).length / hrs.length) * 100),
    };
  }

  // human contributors (bots excluded), top by merged-PR count
  const humans = [...authorCount.entries()].filter(([l]) => !isBot(l)).sort((a, b) => b[1] - a[1]);
  // new-vs-returning cohorts (chronological)
  const seen = new Set();
  const cohorts = [...monthAuthors.keys()]
    .sort()
    .map((m) => {
      const au = [...monthAuthors.get(m)].filter((l) => !isBot(l));
      const nw = au.filter((l) => !seen.has(l)).length;
      const rt = au.filter((l) => seen.has(l)).length;
      au.forEach((l) => seen.add(l));
      return { month: m, new: nw, returning: rt };
    });
  const community = hrs.length
    ? {
        contributors: humans.length,
        prsSampled: hrs.length,
        mergedByDistinct: mergers.size || 1,
        topContributors: humans.slice(0, 10).map(([login]) => ({ login })),
        cohorts,
      }
    : null;

  return { leadTime, community };
}

// ---- creator: followers (a rare, verifiable signal for the profile link) ----
async function creatorInfo(owner) {
  try {
    const d = await gqlRetry(`query($login:String!){ user(login:$login){ followers{ totalCount } } }`, {
      login: owner,
    });
    return { login: owner, followers: d.user?.followers?.totalCount ?? null };
  } catch {
    return { login: owner, followers: null };
  }
}

// ---- clone-conversion from the Traffic Vault (last 7 complete days) ---------
// The RAW vault Blob keys views/clones by day: { views:{[day]:{c,u}}, clones:{...} }.
async function adoption(repo) {
  const vault = await readBlob(`traffic/${repo.toLowerCase().replace("/", "--")}.json`);
  if (!vault?.views || !vault?.clones) return null;
  const days = Object.keys(vault.views).filter((d) => d < today).sort();
  const last7 = days.slice(-7);
  if (!last7.length) return null;
  let uV = 0,
    uC = 0,
    cC = 0;
  for (const d of last7) {
    uV += vault.views[d]?.u || 0;
    uC += vault.clones[d]?.u || 0;
    cC += vault.clones[d]?.c || 0;
  }
  return {
    cloneConvPct: uV > 0 ? Math.round((uC / uV) * 100) : null,
    uniqueClonersWeek: uC || null,
    clonesPerCloner: uC > 0 ? Math.round((cC / uC) * 10) / 10 : null,
  };
}

const pctRank = (sorted, v) => {
  // fraction of the universe with a value <= v, as a percentile 0-100
  let lo = 0,
    hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return Math.round((lo / sorted.length) * 100);
};

async function main() {
  const routePath = join(DATA_DIR, "route.json");
  if (!existsSync(routePath)) {
    console.log("[vitals] no route.json, skipping");
    return;
  }
  const route = JSON.parse(readFileSync(routePath, "utf8"));
  const entries = (route?.repos ?? []).filter((p) => p?.r); // {r, s, v7?, v?, ...}
  if (!entries.length) {
    console.log("[vitals] empty route, skipping");
    return;
  }
  const repos = entries.map((p) => p.r);
  // 7-day star velocity per repo comes free from route.json (velocity7 keystone)
  const v7Of = (repo) => {
    const e = byNameEntry.get(repo.toLowerCase());
    return e?.v7 ?? e?.v ?? 0;
  };
  const byNameEntry = new Map(entries.map((p) => [p.r.toLowerCase(), p]));

  // DISTRIBUTION METRICS = five dimensions of development activity: code
  // (commits), review flow (merged PRs), triage (closed issues), shipping
  // (releases 90d) and momentum (7d velocity). commits/prs/issues/releases from
  // the aliased activity call, v7 free from route.json. The PR/issue searches
  // make the full sweep ~1h (search is capped at 30/min), so Phase A refreshes
  // WEEKLY, not daily; Phase B (unlocked repos) stays daily-fresh.
  const M = ["commits30", "prs30", "issues30", "releases90", "v7"];
  const dims = (a, repo) => ({ ...a, v7: v7Of(repo) });

  // ---- PHASE A: refresh the reference distribution (idempotent, WEEKLY) ------
  // The distribution is stable week to week and its full sweep is search-limited
  // (~1h), so refresh at most every 7 days: refresh only if missing, malformed,
  // or older than a week. Most daily runs skip straight to Phase B.
  let dist = await readBlob("vitals/_dist.json");
  const ageDays = dist?.day ? (Date.parse(today) - Date.parse(dist.day)) / DAY : Infinity;
  const need = !dist || !dist.composite || (dist.universe || 0) < 100 || ageDays >= 7;
  if (need) {
    const target = repos.slice(0, UNIVERSE);
    const raw = []; // per-repo full dims, kept for the composite pass
    let done = 0;
    for (const repo of target) {
      if (done >= DIST_MAX) {
        console.log(`[vitals] dist per-run cap ${DIST_MAX} reached, will resume next run`);
        break;
      }
      try {
        raw.push(dims(await lightActivity(repo), repo));
        done++;
      } catch (e) {
        // one flaky repo must not sink the distribution
      }
      if (PACE_MS) await sleep(PACE_MS);
    }
    if (done >= 30) {
      const metrics = {};
      for (const k of M) metrics[k] = raw.map((a) => a[k] ?? 0).sort((x, y) => x - y);
      // composite distribution: activity is heavily skewed (most repos near 0),
      // so a composite RANK must be measured against the composite distribution,
      // not linearly approximated from the composite percentile.
      const composite = raw
        .map((a) => M.reduce((s, k) => s + pctRank(metrics[k], a[k] ?? 0), 0) / M.length)
        .sort((x, y) => x - y);
      dist = { day: today, computedAt: new Date().toISOString(), universe: done, metrics, composite };
      await writeBlob("vitals/_dist.json", dist);
      console.log(`[vitals] distribution refreshed: ${done} repos`);
    } else {
      console.log(`[vitals] distribution refresh too thin (${done}); keeping previous`);
    }
  } else {
    console.log(`[vitals] distribution already fresh for ${today} (${dist.universe} repos)`);
  }
  if (!dist) {
    console.log("[vitals] no distribution available, cannot compute percentiles; skipping phase B");
    return;
  }

  // ---- PHASE B: full vitals for the unlocked set ----------------------------
  // owned repos present in the route + explicit tenants + always the house repo
  const tenants = (() => {
    try {
      const t = JSON.parse(readFileSync(join(DATA_DIR, "tenants.json"), "utf8"));
      return Array.isArray(t) ? t.map((x) => (x.repo || x).toLowerCase()) : [];
    } catch {
      return [];
    }
  })();
  const unlocked = new Set([config.repo.toLowerCase()]);
  for (const r of repos) if (OWNED.includes(r.split("/")[0].toLowerCase())) unlocked.add(r.toLowerCase());
  for (const t of tenants) unlocked.add(t);

  const byName = new Map(route.repos.map((p) => [p.r.toLowerCase(), p]));
  let wrote = 0;
  for (const repoLc of unlocked) {
    const routeEntry = byName.get(repoLc);
    const repo = routeEntry?.r ?? repoLc;
    try {
      const act = dims(await lightActivity(repo), repo);
      // per-metric percentiles for the fingerprint (all five dimensions)
      const commitsPct = pctRank(dist.metrics.commits30, act.commits30);
      const prsPct = pctRank(dist.metrics.prs30 ?? [0], act.prs30);
      const issuesPct = pctRank(dist.metrics.issues30 ?? [0], act.issues30);
      const releasesPct = pctRank(dist.metrics.releases90 ?? [0], act.releases90);
      const velocityPct = pctRank(dist.metrics.v7 ?? [0], act.v7);
      // composite over ALL dimensions the distribution carries, ranked against
      // the composite distribution — skew-correct, not linearly guessed.
      const dm = Object.keys(dist.metrics);
      const compRaw = dm.reduce((s, k) => s + pctRank(dist.metrics[k], act[k] ?? 0), 0) / dm.length;
      const cdist = dist.composite ?? [];
      const compositePct = cdist.length ? pctRank(cdist, compRaw) : Math.round(compRaw);
      const above = cdist.length ? cdist.filter((c) => c > compRaw).length : 0;
      const compositeRank = Math.max(1, above + 1);
      const { leadTime: lt, community: cm } = await prAnalysis(repo).catch(() => ({
        leadTime: null,
        community: null,
      }));
      const ad = await adoption(repo).catch(() => null);
      const creator = await creatorInfo(repo.split("/")[0]);
      const perWeek = Math.round((act.releases90 / 90) * 7 * 10) / 10;
      const deploy = {
        releases90: act.releases90,
        perWeek,
        tier: perWeek >= 7 ? "Elite" : perWeek >= 1 ? "High" : perWeek >= 0.25 ? "Medium" : "Low",
      };
      const vitals = {
        repo,
        computedAt: new Date().toISOString(),
        universe: dist.universe,
        verdict: compositePct >= 50 ? "ALIVE" : "MONUMENT",
        creator,
        activity: {
          ...act,
          commitsPct,
          prsPct,
          issuesPct,
          releasesPct,
          velocityPct,
          compositePct,
          compositeRank,
        },
        leadTime: lt,
        deploy,
        adoption: ad,
        community: cm,
      };
      await writeBlob(blobKey(repo), vitals);
      wrote++;
      console.log(
        `[vitals] ${repo}: activity top ${100 - compositePct}% (#${compositeRank}/${dist.universe})` +
          (lt ? ` · lead ${lt.medianH}h ${lt.tier}` : "") +
          (cm ? ` · ${cm.contributors} contribs · ${cm.mergedByDistinct} merger(s)` : "") +
          ` · ${vitals.verdict}`,
      );
    } catch (e) {
      console.error(`[vitals] ${repo} failed (non-fatal): ${e?.message ?? e}`);
    }
    if (PACE_MS) await sleep(PACE_MS);
  }
  console.log(`[vitals] wrote ${wrote} unlocked repo vitals`);
}

main().catch((err) => {
  console.error(`[vitals] failed (non-fatal): ${err?.message ?? err}`);
  process.exit(0);
});
