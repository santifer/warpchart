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
import { DATA_DIR, graphql, ghFetch, sleep, token, readConfig } from "./lib.mjs";

token(); // GitHub token: fail fast
const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
if (!blobToken) {
  console.log("[vitals] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

const UNIVERSE = Math.max(50, Number(process.env.VITALS_UNIVERSE || 1000));
const DIST_MAX = Math.max(1, Number(process.env.VITALS_DIST_MAX || 1000));
// Time budget for the resumable distribution sweep. Must leave room inside the
// STEP timeout for Phase B, which is the part that actually refreshes the
// panel; Phase A only rebuilds the reference population, once a week.
const DEADLINE_MS = Math.max(10_000, Number(process.env.VITALS_DEADLINE_MS || 150_000));
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

// Append one daily snapshot of an unlocked repo's headline signals so a REAL
// trend can be drawn later (no backfill exists — the honest 30d/90d trend has to
// accrue from here). Dedup by day (idempotent within a day), cap to ~180 points.
const histKey = (repo) => `vitals/hist--${repo.toLowerCase().replace("/", "--")}.json`;
async function appendHistory(repo, point) {
  const key = histKey(repo);
  const prev = (await readBlob(key)) || { repo, points: [] };
  const points = (Array.isArray(prev.points) ? prev.points : []).filter((p) => p.day !== point.day);
  points.push(point);
  points.sort((a, b) => (a.day < b.day ? -1 : 1));
  await writeBlob(key, { repo, points: points.slice(-180) });
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
        createdAt
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
  const createdAt = d.repository?.createdAt ?? null;
  const cutoff = Date.now() - 90 * DAY;
  const releases90 = (d.repository?.releases?.nodes ?? []).filter(
    (r) => r.publishedAt && !r.isPrerelease && Date.parse(r.publishedAt) >= cutoff,
  ).length;
  return { commits30, prs30, issues30, releases90, createdAt };
}

// ---- one merged-PR sweep -> DORA lead time + the human engine ---------------
// Paginate merged PRs once, gathering createdAt/mergedAt (lead time), author
// (contributors + cohorts) and mergedBy (the maintainer gate). Two derived
// panels for the price of one pagination.
const BOTS = new Set([
  "github-actions", "renovate", "dependabot", "renovate-bot", "codecov",
  // the manifesto ledger's service account: commits under a human-shaped login
  "careerops-ledger",
]);
const isBot = (l) => !l || BOTS.has(l.toLowerCase()) || l.toLowerCase().endsWith("[bot]");

// TRUE number of contributors, the same one github.com/{repo}/graphs/contributors
// shows. The PR sample below can only ever see the authors inside its window
// (138 of the real 213 on 2026-07-28), and the panel links straight to that
// GitHub page - so publishing the sample's count meant the figure contradicted
// itself the moment anyone clicked it.
async function contributorsCount(repo) {
  try {
    let total = 0;
    for (let page = 1; page <= 6; page++) {
      const rows = await ghFetch(`/repos/${repo}/contributors?per_page=100&anon=0&page=${page}`);
      if (!Array.isArray(rows)) break;
      total += rows.length;
      if (rows.length < 100) break; // last page
    }
    return total || null;
  } catch {
    return null; // fall back to the sample count rather than invent one
  }
}

// want=1000 covers a repo's ENTIRE merged history up to that size (career-ops
// has 707), which is what makes the month-over-month cohorts real instead of an
// artefact of where the window happened to stop. Above 1000 the oldest month is
// dropped as truncated, so the series never claims to know what it cannot.
//
// 2026-08-04: career-ops reached 837 merged at ~3.2/day - on course to cross
// 1000 in late September, at which point this window would silently stop being
// a census and the cohorts would shift with nothing about the project changing.
// The cohorts are therefore SUPERSEDED by the commit census in phase B whenever
// collector/contributors.mjs has published one (a census has no window). The
// sampled cohorts computed here remain only as the fallback for repos without
// a census store, still guarded by the truncation drop below.
async function prAnalysis(repo, want = 1000) {
  const [owner, name] = repo.split("/");
  const hrs = [];
  const authorCount = new Map();
  const mergers = new Set();
  const monthAuthors = new Map(); // "YYYY-MM" -> Set(login)
  let cursor = null;
  let mergedTotal = null;
  // Two different windows on purpose. COHORTS need the whole history to say who
  // came back; LEAD TIME is a statement about how the project works NOW, so it
  // only counts PRs merged in the last 90 days. Measuring it over all 707 mixed
  // in the slower early months and dropped the repo from Elite to High while
  // nothing about today had changed.
  const LEAD_WINDOW = Date.now() - 90 * DAY;
  let scanned = 0;
  while (scanned < want) {
    const d = await gqlRetry(
      `query($owner:String!,$name:String!,$after:String){
        repository(owner:$owner,name:$name){
          pullRequests(states:MERGED, first:100, orderBy:{field:CREATED_AT,direction:DESC}, after:$after){
            totalCount
            pageInfo{ hasNextPage endCursor }
            nodes{ createdAt mergedAt author{ login } mergedBy{ login } }
          }
        }
      }`,
      { owner, name, after: cursor },
    );
    const pr = d.repository?.pullRequests;
    if (!pr) break;
    if (mergedTotal === null) mergedTotal = pr.totalCount ?? null;
    for (const n of pr.nodes) {
      if (!n.createdAt || !n.mergedAt) continue;
      scanned++;
      const merged = Date.parse(n.mergedAt);
      const h = (merged - Date.parse(n.createdAt)) / 36e5;
      if (h >= 0 && merged >= LEAD_WINDOW) hrs.push(h);
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
      windowDays: 90, // the window this median describes, so the panel can say so
      sample: hrs.length,
      pctUnder24h: Math.round((hrs.filter((h) => h <= 24).length / hrs.length) * 100),
      pctUnder7d: Math.round((hrs.filter((h) => h <= 168).length / hrs.length) * 100),
    };
  }

  // human contributors (bots excluded), top by merged-PR count
  const humans = [...authorCount.entries()].filter(([l]) => !isBot(l)).sort((a, b) => b[1] - a[1]);
  // Did we stop before reaching the repo's first PR? Then the OLDEST month in
  // the sample is a lie by construction: nobody can be "returning" in it,
  // because the algorithm has not seen anyone yet. On 2026-07-28 that published
  // "returning devs 0 → 18" for a repo whose June returners simply fell outside
  // the window - and the series jumped from "1 → 7 → 17" to "0 → 18" overnight
  // as the growing PR volume shrank the window. Drop the truncated month.
  const truncated = scanned >= want;
  const months = [...monthAuthors.keys()].sort();
  // new-vs-returning cohorts (chronological)
  const seen = new Set();
  const cohorts = months
    .map((m) => {
      const au = [...monthAuthors.get(m)].filter((l) => !isBot(l));
      const nw = au.filter((l) => !seen.has(l)).length;
      const rt = au.filter((l) => seen.has(l)).length;
      au.forEach((l) => seen.add(l));
      return { month: m, new: nw, returning: rt };
    })
    .filter((c) => !(truncated && c.month === months[0]));
  const maintainers = [...mergers].filter((l) => !isBot(l)).slice(0, 6);
  const community = scanned
    ? {
        // the real repo-wide figure; `contributorsSampled` is what the window saw
        contributors: (await contributorsCount(repo)) ?? humans.length,
        contributorsSampled: humans.length,
        mergedTotal, // every merged PR ever, not just the sampled window
        prsSampled: hrs.length,
        mergedByDistinct: mergers.size || 1,
        maintainers, // the actual merge-gate keepers, for their avatars
        topContributors: humans.slice(0, 10).map(([login]) => ({ login })),
        cohorts,
      }
    : null;

  return { leadTime, community };
}

// ---- responsiveness (CHAOSS time-to-first-response) -------------------------
// Median time from an issue opened to the FIRST reply by a maintainer
// (OWNER/MEMBER/COLLABORATOR, non-bot, not the author), over recent issues, 90d.
// "the system attends to the community, fast" — a quality-of-maintenance signal
// that scales attention, not just code. Public timeline, no search.
const MAINTAINER_ASSOC = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
// 6 pages, not 2. The newest issues are precisely the ones nobody has answered
// YET, so a short window is biased toward "no reply" and starves the sample: on
// 2026-07-28 the first 100 issues yielded 4 measurements (below the threshold,
// so the panel silently dropped the stat), while 300 issues yield 82 and a
// median of 28.9h. The 20.5h it printed the day before came from a handful of
// cases either side of the cutoff - a number that appears and disappears is
// worse than one that is absent.
async function responsiveness(repo, pages = 6) {
  const [owner, name] = repo.split("/");
  const since = Date.now() - 90 * DAY;
  const hrs = [];
  let cursor = null;
  for (let p = 0; p < pages; p++) {
    const d = await gqlRetry(
      `query($owner:String!,$name:String!,$after:String){
        repository(owner:$owner,name:$name){
          issues(first:50, orderBy:{field:CREATED_AT,direction:DESC}, after:$after){
            pageInfo{ hasNextPage endCursor }
            nodes{ createdAt author{ login }
              comments(first:12){ nodes{ createdAt authorAssociation author{ login } } } }
          }
        }
      }`,
      { owner, name, after: cursor },
    );
    const iss = d.repository?.issues;
    if (!iss) break;
    let allOld = true;
    for (const n of iss.nodes) {
      if (!n.createdAt) continue;
      const created = Date.parse(n.createdAt);
      if (created < since) continue;
      allOld = false;
      const authorLc = n.author?.login?.toLowerCase();
      const first = (n.comments?.nodes ?? []).find(
        (c) =>
          MAINTAINER_ASSOC.has(c.authorAssociation) &&
          !isBot(c.author?.login) &&
          c.author?.login?.toLowerCase() !== authorLc,
      );
      if (first?.createdAt) {
        const h = (Date.parse(first.createdAt) - created) / 36e5;
        if (h >= 0) hrs.push(h);
      }
    }
    if (allOld || !iss.pageInfo.hasNextPage) break;
    cursor = iss.pageInfo.endCursor;
    if (PACE_MS) await sleep(PACE_MS);
  }
  // 20, not 5: a median built from five cases is noise wearing a decimal point.
  // Publishing nothing is honest; publishing a figure that swings by 40% on the
  // next run is not.
  if (hrs.length < 20) return null;
  hrs.sort((a, b) => a - b);
  const q = (pp) => {
    const k = (hrs.length - 1) * pp;
    const f = Math.floor(k);
    return hrs[f] + (hrs[Math.min(f + 1, hrs.length - 1)] - hrs[f]) * (k - f);
  };
  return {
    medianH: Math.round(q(0.5) * 10) / 10,
    p90H: Math.round(q(0.9) * 10) / 10,
    sample: hrs.length,
    pctUnder24h: Math.round((hrs.filter((h) => h <= 24).length / hrs.length) * 100),
    pctUnder48h: Math.round((hrs.filter((h) => h <= 48).length / hrs.length) * 100),
  };
}

// ---- automation footprint: the unattended machinery, made visible -----------
// Over a sample of recent merged PRs: median status checks per PR (CI rigor),
// the share authored by bots (dependency/automation lane), and the distinct bots
// orchestrated. Shows "there is a SYSTEM here, not a hero." Public, no search.
async function automation(repo, pages = 2) {
  const [owner, name] = repo.split("/");
  const checks = [];
  const botLogins = new Set();
  let botPRs = 0;
  let total = 0;
  let cursor = null;
  for (let p = 0; p < pages; p++) {
    const d = await gqlRetry(
      `query($owner:String!,$name:String!,$after:String){
        repository(owner:$owner,name:$name){
          pullRequests(states:MERGED, first:50, orderBy:{field:CREATED_AT,direction:DESC}, after:$after){
            pageInfo{ hasNextPage endCursor }
            nodes{ author{ login }
              commits(last:1){ nodes{ commit{ statusCheckRollup{ contexts{ totalCount } } } } } }
          }
        }
      }`,
      { owner, name, after: cursor },
    );
    const pr = d.repository?.pullRequests;
    if (!pr) break;
    for (const n of pr.nodes) {
      total++;
      const login = n.author?.login;
      if (isBot(login)) {
        botPRs++;
        if (login) botLogins.add(login.toLowerCase().replace(/\[bot\]$/, ""));
      }
      const c = n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.totalCount;
      if (typeof c === "number") checks.push(c);
    }
    if (!pr.pageInfo.hasNextPage) break;
    cursor = pr.pageInfo.endCursor;
    if (PACE_MS) await sleep(PACE_MS);
  }
  if (!total) return null;
  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  };
  return {
    statusChecksPerPR: median(checks),
    botPRPct: Math.round((botPRs / total) * 100),
    bots: [...botLogins].slice(0, 8),
    sampled: total,
  };
}

// ---- agent-readiness: is this repo agent-NATIVE, not just active? -----------
// Pure file-existence from the PUBLIC tree (no owner-reported input, no
// estimation): CLAUDE.md, AGENTS.md, the .claude/ machinery (skills, commands,
// subagents), an MCP config, cursor rules. One aliased GraphQL call reads the
// HEAD tree and the relevant subtrees; a non-existent path returns null. Answers
// "does this codebase ship the artifacts of an agentic SDLC?" — verifiable by
// anyone who opens the repo.
async function agentReadiness(repo) {
  const [owner, name] = repo.split("/");
  const T = (alias, expr) =>
    `${alias}: object(expression:${JSON.stringify(expr)}){ ... on Tree { entries{ name type } } }`;
  const d = await gqlRetry(
    `query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        ${T("root", "HEAD:")}
        ${T("claude", "HEAD:.claude")}
        ${T("skills", "HEAD:.claude/skills")}
        ${T("commands", "HEAD:.claude/commands")}
        ${T("subagents", "HEAD:.claude/agents")}
        ${T("cursor", "HEAD:.cursor/rules")}
      }
    }`,
    { owner, name },
  );
  const r = d?.repository;
  if (!r) return null;
  const rootEntries = r.root?.entries ?? [];
  const rootNames = new Set(rootEntries.map((e) => e.name));
  const claudeEntries = r.claude?.entries ?? [];
  const dirCount = (e) => (e?.entries ?? []).filter((x) => x.type === "tree").length;
  const count = (e) => (e?.entries ?? []).length;

  const claudeMd = rootNames.has("CLAUDE.md") || claudeEntries.some((e) => e.name === "CLAUDE.md");
  const agentsMd = rootNames.has("AGENTS.md");
  // skills live one-dir-per-skill under .claude/skills; fall back to a flat file
  // layout. commands / subagents are flat .md files.
  const skills = r.skills ? dirCount(r.skills) || count(r.skills) : 0;
  const commands = r.commands ? count(r.commands) : 0;
  const subagents = r.subagents ? count(r.subagents) : 0;
  const mcp =
    rootNames.has(".mcp.json") ||
    rootNames.has("mcp.json") ||
    claudeEntries.some((e) => /^\.?mcp.*\.json$/i.test(e.name));
  const cursorRules = (r.cursor ? count(r.cursor) : 0) + (rootNames.has(".cursorrules") ? 1 : 0);

  // display chips, most on-brand first
  const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;
  const chips = [];
  if (claudeMd) chips.push("CLAUDE.md");
  if (agentsMd) chips.push("AGENTS.md");
  if (skills) chips.push(plural(skills, "skill"));
  if (commands) chips.push(plural(commands, "command"));
  if (subagents) chips.push(plural(subagents, "subagent"));
  if (mcp) chips.push("MCP");
  if (cursorRules) chips.push(plural(cursorRules, "cursor rule"));

  const signals = [claudeMd, agentsMd, skills > 0, commands > 0, subagents > 0, mcp, cursorRules > 0].filter(
    Boolean,
  ).length;
  const agentNative = claudeMd || agentsMd || skills > 0 || mcp;
  return { agentNative, claudeMd, agentsMd, skills, commands, subagents, mcp, cursorRules, chips, signals };
}

// ---- revert rate: throughput is only half the story ("does a lot") — this is
// the other half ("and doesn't break things"). Public: merged PRs whose TITLE
// carries a revert, over all merged PRs, 90d window. Two search aliases, one
// call. Shown as one quiet stat (a title-revert rate is a shallow, floor-heavy
// signal — not a headline), never ranked against other repos.
async function revertRate(repo) {
  const day = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10);
  const d = await gqlRetry(
    `query($qt:String!,$qr:String!){
      qt: search(query:$qt, type:ISSUE){ issueCount }
      qr: search(query:$qr, type:ISSUE){ issueCount }
    }`,
    {
      qt: `repo:${repo} type:pr is:merged merged:>${day}`,
      qr: `repo:${repo} type:pr is:merged merged:>${day} revert in:title`,
    },
  );
  const mergedPRs = d?.qt?.issueCount ?? 0;
  const reverts = d?.qr?.issueCount ?? 0;
  return {
    window: 90,
    mergedPRs,
    reverts,
    revertPct: mergedPRs ? Math.round((reverts / mergedPRs) * 1000) / 10 : 0,
  };
}

// ---- docs / community health: the "beyond-code" bar hiring leads look for ----
// GitHub computes its own community-health % (README, CONTRIBUTING, code of
// conduct, security policy, issue/PR templates, license). We surface GitHub's
// own number + which files exist — authoritative, public, one REST call. Docs
// were the single most-cited "great maintainer" signal across the research.
async function docsHealth(repo) {
  const [owner, name] = repo.split("/");
  try {
    const p = await ghFetch(`/repos/${owner}/${name}/community/profile`);
    const f = p?.files ?? {};
    const has = (k) => Boolean(f[k]);
    const readme = has("readme");
    const contributing = has("contributing");
    const codeOfConduct = has("code_of_conduct") || has("code_of_conduct_file");
    const security = has("security");
    const issueTemplate = has("issue_template");
    const prTemplate = has("pull_request_template");
    const license = has("license");
    const chips = [];
    if (readme) chips.push("README");
    if (contributing) chips.push("CONTRIBUTING");
    if (codeOfConduct) chips.push("CoC");
    if (security) chips.push("SECURITY");
    if (issueTemplate || prTemplate) chips.push("templates");
    if (license) chips.push("license");
    return {
      healthPct: typeof p?.health_percentage === "number" ? p.health_percentage : null,
      readme,
      contributing,
      codeOfConduct,
      security,
      issueTemplate,
      prTemplate,
      license,
      chips,
    };
  } catch {
    return null;
  }
}

// ---- onboarding: does the project actively welcome newcomers? ---------------
// Open "good first issue" count — the concrete, public tell that a maintainer
// runs a contributor funnel (community leadership, not just code). Two label
// spellings, one call. Newcomer RETENTION comes free from the PR cohorts.
//
// COUNT THE FREE ONES, NEVER THE LABELED ONES. A newcomer cannot start on an
// issue somebody else already took, so a pool of labeled issues is not a pool
// of entry points. career-ops on 9 Aug 2026: 12 labeled, 11 with an owner, 1
// actually free - and this collector had been publishing "12 good first
// issues" as a health signal the whole time. The counter never failed and
// never errored; it counted signs instead of counting openings. Reported by
// career-ops-maintainer, who found the same bug in his own radar the same day.
//
// `open` stays in the payload because it is the denominator that makes `free`
// legible ("1 of 12" says something "1" alone does not), but `free` is the
// headline everywhere downstream.
//
// BLIND SPOT, DECLARED: search sees assignees and linked PRs, not people who
// called an issue in the comments. `free` is therefore an UPPER bound. Measured
// against career-ops-maintainer's co-claims.mjs on the same 12, this returns
// his free set plus exactly the one comment-claim, so the bound is tight but
// it is a bound. A consumer must never read it as "definitely available".
//
// A failed lookup returns free:null, never free:open. An outage that silently
// refills the pool is the same lie in a different costume.
async function onboarding(repo) {
  const base = (label) => `repo:${repo} is:issue is:open label:"${label}"`;
  try {
    const d = await gqlRetry(
      `query($q:String!,$q2:String!,$f:String!,$f2:String!){
        a: search(query:$q,  type:ISSUE){ issueCount }
        b: search(query:$q2, type:ISSUE){ issueCount }
        c: search(query:$f,  type:ISSUE){ issueCount }
        d: search(query:$f2, type:ISSUE){ issueCount }
      }`,
      {
        q: base("good first issue"),
        q2: base("good-first-issue"),
        // no:assignee drops the claimed ones; -linked:pr drops the ones that
        // already have a PR on the way. Both are server-side, so this costs
        // nothing beyond the two extra search fields.
        f: `${base("good first issue")} no:assignee -linked:pr`,
        f2: `${base("good-first-issue")} no:assignee -linked:pr`,
      },
    );
    const open = Math.max(d?.a?.issueCount ?? 0, d?.b?.issueCount ?? 0);
    const freeRaw = Math.max(d?.c?.issueCount ?? 0, d?.d?.issueCount ?? 0);
    // the free set is a subset of the open set by construction; if the two
    // spellings ever disagree enough to break that, trust the smaller number
    return { goodFirstIssues: open, goodFirstIssuesFree: Math.min(freeRaw, open) };
  } catch {
    return null;
  }
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
  // M = every dimension kept in the distribution (v7 stays so the fingerprint can
  // still show a star-velocity percentile). COMPOSITE_M = the dimensions that make
  // up the "development activity" RANK — star velocity is popularity, not
  // development, so it is deliberately EXCLUDED from the rank (it would make the
  // rank sag as viral hype cools even when engineering is unchanged).
  const M = ["commits30", "prs30", "issues30", "releases90", "v7"];
  const COMPOSITE_M = ["commits30", "prs30", "issues30", "releases90"];
  const dims = (a, repo) => ({ ...a, v7: v7Of(repo) });

  // ---- PHASE A: refresh the reference distribution (idempotent, WEEKLY) ------
  // The distribution is stable week to week and its full sweep is search-limited
  // (~1h), so refresh at most every 7 days: refresh only if missing, malformed,
  // or older than a week. Most daily runs skip straight to Phase B.
  let dist = await readBlob("vitals/_dist.json");
  const ageDays = dist?.day ? (Date.parse(today) - Date.parse(dist.day)) / DAY : Infinity;
  // rebuild if the composite definition changed (e.g. star velocity removed) so
  // the new rank basis takes effect at once, not on the next weekly refresh.
  const compDefChanged = (dist?.compositeMetrics ?? []).join(",") !== COMPOSITE_M.join(",");
  const need =
    !dist || !dist.composite || (dist.universe || 0) < 100 || ageDays >= 7 || compDefChanged;

  // Fast path: ONLY the composite definition changed and we still have the raw
  // per-repo rows + a fresh distribution — recompute the composite in-memory, no
  // ~1h re-sweep. (First run after this ships has no stored raw, so it sweeps
  // once and stores raw; every later definition tweak is free.)
  const canRecompute =
    compDefChanged &&
    dist?.metrics &&
    Array.isArray(dist.raw) &&
    (dist.universe || 0) >= 100 &&
    ageDays < 7;
  if (canRecompute) {
    const composite = dist.raw
      .map((a) => COMPOSITE_M.reduce((s, k) => s + pctRank(dist.metrics[k], a[k] ?? 0), 0) / COMPOSITE_M.length)
      .sort((x, y) => x - y);
    dist = { ...dist, composite, compositeMetrics: COMPOSITE_M, computedAt: new Date().toISOString() };
    await writeBlob("vitals/_dist.json", dist);
    console.log(`[vitals] composite recomputed from stored raw (${COMPOSITE_M.join("+")}), no sweep`);
  } else if (need) {
    const target = repos.slice(0, UNIVERSE);
    // RESUMABLE. The sweep is search-limited to ~15 repos/min, so a full 999
    // takes about an hour - it can NEVER finish inside one CI job. It used to
    // restart from zero every run, get killed by the step timeout before
    // writing anything, and take Phase B down with it: the whole Vital Signs
    // panel sat frozen from 2026-07-19 to 2026-07-27 while the workflow
    // reported success every two hours. Now each run spends a fixed time
    // budget, PERSISTS what it collected, and the next one picks up where it
    // stopped. Roughly a day and a half to a full sweep, once a week.
    const started = Date.now();
    let prog = await readBlob("vitals/_dist-progress.json");
    if (!prog || prog.universe !== UNIVERSE || !Array.isArray(prog.raw) || prog.repos !== target.length) {
      prog = { startedDay: today, universe: UNIVERSE, repos: target.length, idx: 0, raw: [] };
    }
    const raw = prog.raw;
    let done = raw.length;
    let i = prog.idx;
    for (; i < target.length; i++) {
      if (Date.now() - started > DEADLINE_MS) break;
      if (done - prog.raw.length >= DIST_MAX) break;
      try {
        raw.push(dims(await lightActivity(target[i]), target[i]));
        done++;
      } catch (e) {
        // one flaky repo must not sink the distribution
      }
      if (PACE_MS) await sleep(PACE_MS);
    }
    const complete = i >= target.length;
    if (!complete) {
      // Save and hand over to Phase B: a partial sweep must never cost the
      // tenant its daily refresh, which is the whole point of the panel.
      await writeBlob("vitals/_dist-progress.json", { ...prog, idx: i, raw });
      console.log(`[vitals] distribution sweep at ${i}/${target.length} (${done} measured), resuming next run`);
    }
    // Only publish a distribution built from the WHOLE universe: a rank of
    // "#24 of 30" read as "#24 of 999" would be a lie, and a rank is the one
    // number on this panel that cannot be approximated.
    if (complete && done >= 30) {
      const metrics = {};
      for (const k of M) metrics[k] = raw.map((a) => a[k] ?? 0).sort((x, y) => x - y);
      // composite distribution: activity is heavily skewed (most repos near 0),
      // so a composite RANK must be measured against the composite distribution,
      // not linearly approximated from the composite percentile.
      const composite = raw
        .map((a) => COMPOSITE_M.reduce((s, k) => s + pctRank(metrics[k], a[k] ?? 0), 0) / COMPOSITE_M.length)
        .sort((x, y) => x - y);
      dist = {
        day: today,
        computedAt: new Date().toISOString(),
        universe: done,
        metrics,
        composite,
        compositeMetrics: COMPOSITE_M,
        // keep the per-repo rows so a later composite-definition change (drop or
        // add a metric) can recompute the composite WITHOUT a full re-sweep.
        raw: raw.map((a) => ({
          commits30: a.commits30,
          prs30: a.prs30,
          issues30: a.issues30,
          releases90: a.releases90,
          v7: a.v7,
        })),
      };
      await writeBlob("vitals/_dist.json", dist);
      // progress consumed: the next weekly refresh starts a clean sweep
      await writeBlob("vitals/_dist-progress.json", { startedDay: today, universe: UNIVERSE, repos: 0, idx: 0, raw: [] });
      console.log(`[vitals] distribution refreshed: ${done} repos (full sweep complete)`);
    } else if (complete) {
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
      const velocityPct = pctRank(dist.metrics.v7 ?? [0], act.v7); // fingerprint only
      // composite over the DEVELOPMENT dimensions only (star velocity excluded —
      // it is popularity, not development), ranked against the composite
      // distribution — skew-correct, not linearly guessed.
      const compMetrics = (dist.compositeMetrics ?? COMPOSITE_M).filter((k) => dist.metrics[k]);
      const compRaw =
        compMetrics.reduce((s, k) => s + pctRank(dist.metrics[k], act[k] ?? 0), 0) / compMetrics.length;
      const cdist = dist.composite ?? [];
      const compositePct = cdist.length ? pctRank(cdist, compRaw) : Math.round(compRaw);
      const above = cdist.length ? cdist.filter((c) => c > compRaw).length : 0;
      const compositeRank = Math.max(1, above + 1);
      const { leadTime: lt, community: cm } = await prAnalysis(repo).catch(() => ({
        leadTime: null,
        community: null,
      }));
      // Cohorts from the commit census when one exists (collector/contributors.mjs
      // runs earlier in the same workflow). The census is derived from the full
      // commit history, so it stays a census forever; the PR-sampled cohorts
      // above stop covering the whole history once the repo crosses want=1000
      // merged PRs (career-ops: on course for late September 2026) and start
      // re-labelling early people as "new". Same {month,new,returning} contract.
      if (cm) {
        const census = await readBlob(`contributors/${repo.toLowerCase().replace("/", "--")}.json`);
        if (census?.months?.length) {
          cm.cohorts = census.months.map((m) => ({ month: m.month, new: m.new, returning: m.returning }));
          cm.cohortsSource = "commit-census";
          cm.busFactor = census.busFactor ?? null;
          // the evolution chart's data: daily cumulative series for both
          // readings (strict authors / GitHub-box-style credited), embedded so
          // the UI keeps reading ONE blob per repo
          if (census.series?.authorsDaily?.length) {
            cm.census = {
              authorsDaily: census.series.authorsDaily,
              creditedDaily: census.series.creditedDaily ?? census.series.authorsDaily,
              authors: census.series.authors,
              credited: census.series.credited ?? census.series.authors,
              aiCoCredits: census.aiCoCredits ?? 0,
              measuredAt: census.updated_at ?? null,
            };
          }
        }
      }
      const ad = await adoption(repo).catch(() => null);
      const ar = await agentReadiness(repo).catch(() => null);
      // revert rate is search-bearing like lightActivity above — space it out to
      // stay under the GraphQL search cap (30/min)
      await sleep(Math.max(PACE_MS, 1200));
      const quality = await revertRate(repo).catch(() => null);
      const ttfr = await responsiveness(repo).catch(() => null);
      const auto = await automation(repo).catch(() => null);
      const docs = await docsHealth(repo).catch(() => null);
      await sleep(Math.max(PACE_MS, 1200)); // onboarding is search-bearing
      const onboard = await onboarding(repo).catch(() => null);
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
        agentReadiness: ar,
        quality,
        responsiveness: ttfr,
        automation: auto,
        docs,
        onboarding: onboard,
        createdAt: act.createdAt ?? null,
      };
      await writeBlob(blobKey(repo), vitals);
      // seed the honest trend: one snapshot per day of the headline signals
      await appendHistory(repo, {
        day: today,
        rank: compositeRank,
        pct: compositePct,
        v7: act.v7,
        ttfr: ttfr?.medianH ?? null,
        revert: quality?.revertPct ?? null,
      }).catch(() => {});
      wrote++;
      console.log(
        `[vitals] ${repo}: activity top ${100 - compositePct}% (#${compositeRank}/${dist.universe})` +
          (lt ? ` · lead ${lt.medianH}h ${lt.tier}` : "") +
          (cm ? ` · ${cm.contributors} contribs · ${cm.mergedByDistinct} merger(s)` : "") +
          (ar?.agentNative ? ` · agent-native [${ar.chips.join(" · ")}]` : "") +
          (quality ? ` · revert ${quality.revertPct}%` : "") +
          (ttfr ? ` · ttfr ${ttfr.medianH}h` : "") +
          (auto ? ` · ${auto.statusChecksPerPR} checks/PR · ${auto.bots.length} bots` : "") +
          (docs ? ` · docs ${docs.healthPct}% [${docs.chips.join(",")}]` : "") +
          // free-of-labeled, because "12 GFI" is precisely the reading that
          // kept a one-issue pool looking healthy in this very log
          (onboard
            ? ` · GFI ${onboard.goodFirstIssuesFree ?? "?"}/${onboard.goodFirstIssues} free`
            : "") +
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
