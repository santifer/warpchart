// PR FLOW collector — what goes IN and what comes OUT of a repo's pull-request
// queue, day by day. Opened above the axis, merged and closed-without-merge
// below, plus the open queue at each day's close and the median age of that
// queue. The line is what keeps the bars honest: a queue that grows while the
// outflow keeps pace is growth; a queue that grows with no outflow is neglect.
//
// Derived from each PR's own timestamps (createdAt / mergedAt / closedAt), NOT
// from snapshots, so a missed collector run cannot fabricate a zero day: the
// cron declares every 2h but really fires every ~6h, and a snapshot series
// would inherit that. The day in progress (UTC) is left out until it closes.
//
// Bots are excluded from every series (dependabot & co. would read as community
// inflow) and counted once, so the panel can say how many were left out.
//
// Unlocked repos only, same set as vitals.mjs phase B: a full pass is one
// paginated query per 100 PRs (career-ops: ~2.700 PRs, ~28 calls), which is fine
// for a handful of repos and impossible for the 10k index. Written to the
// PRIVATE Blob at prflow/{owner}--{name}.json; presence of that file IS the
// unlock gate the loader (src/lib/prflow.ts) reads.
//
// Usage: GITHUB_TOKEN=... BLOB_READ_WRITE_TOKEN=... node collector/prflow.mjs [owner/repo ...]
//   (no args = the unlocked set, same as vitals.mjs phase B and contributors.mjs)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { put } from "@vercel/blob";
import { DATA_DIR, graphql, sleep, token, readConfig, canonicalRepo } from "./lib.mjs";
import { acceptPrCount } from "./guards.mjs";
import { markPartial, markComplete, readFresh, partialKey } from "./blob.mjs";

const DAY = 864e5;
const BOT_LOGINS = new Set(["dependabot", "renovate", "github-actions", "pre-commit-ci", "allcontributors", "coderabbitai", "copilot-swe-agent"]);
const isBot = (a) =>
  !!a && (a.__typename === "Bot" || /\[bot\]$/i.test(a.login) || BOT_LOGINS.has(a.login.toLowerCase()));

export const prflowKey = (repo) => `prflow/${repo.toLowerCase().replace("/", "--")}.json`;

async function gqlRetry(query, vars, tries = 4) {
  let delay = 1500;
  for (let i = 0; i < tries; i++) {
    try {
      return await graphql(query, vars);
    } catch (e) {
      const transient = /rate limit|secondary|abuse|403|429|500|502|503|timeout/i.test(String(e?.message || e));
      if (i === tries - 1 || !transient) throw e;
      await sleep(delay);
      delay *= 2;
    }
  }
}

async function allPulls(repo) {
  const [owner, name] = repo.split("/");
  const out = [];
  let after = null;
  for (;;) {
    const d = await gqlRetry(
      `query($owner:String!,$name:String!,$after:String){
        repository(owner:$owner,name:$name){
          pullRequests(first:100, orderBy:{field:CREATED_AT,direction:ASC}, after:$after){
            pageInfo{ hasNextPage endCursor }
            nodes{ state createdAt mergedAt closedAt author{ __typename login } }
          }
        }
      }`,
      { owner, name, after },
    );
    const c = d.repository?.pullRequests;
    if (!c) {
      // Not found on the first page: nothing to chart. Vanishing MID-way is a
      // truncated list, and publishing it would redraw the queue from a
      // fraction of the PRs: fail loudly instead of returning what we have.
      if (out.length) throw new Error(`${repo} stopped answering after ${out.length} PRs (pagination cut short)`);
      break;
    }
    out.push(...c.nodes);
    if (!c.pageInfo.hasNextPage) break;
    after = c.pageInfo.endCursor;
  }
  return out;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// days: [day, opened, merged, closedUnmerged, openAtClose, medianAgeDaysOfOpen]
export function buildFlow(pulls, now = Date.now()) {
  const humans = [];
  let bots = 0;
  for (const p of pulls) {
    if (isBot(p.author)) bots++;
    else
      humans.push({
        c: Date.parse(p.createdAt),
        m: p.mergedAt ? Date.parse(p.mergedAt) : null,
        // a merged PR also carries closedAt: it counts as MERGED, never as closed.
        // And only a PR that IS closed now counts as closed: a reopened one is
        // back in the queue. (GitHub search undercounts this series: on 25-sep
        // `is:unmerged closed:17..24` said 7 where GraphQL and REST both had 31.)
        x: !p.mergedAt && p.state === "CLOSED" && p.closedAt ? Date.parse(p.closedAt) : null,
      });
  }
  if (!humans.length) return null;
  const todayStart = Date.parse(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z");
  const first = Date.parse(new Date(Math.min(...humans.map((h) => h.c))).toISOString().slice(0, 10) + "T00:00:00Z");
  const days = [];
  for (let t = first; t < todayStart; t += DAY) {
    const end = t + DAY; // exclusive: the day's close
    let o = 0, m = 0, x = 0;
    const ages = [];
    for (const h of humans) {
      if (h.c >= t && h.c < end) o++;
      if (h.m !== null && h.m >= t && h.m < end) m++;
      if (h.x !== null && h.x >= t && h.x < end) x++;
      const gone = h.m ?? h.x;
      if (h.c < end && (gone === null || gone >= end)) ages.push((end - h.c) / DAY);
    }
    const age = median(ages);
    days.push([new Date(t).toISOString().slice(0, 10), o, m, x, ages.length, age === null ? null : Math.round(age)]);
  }
  return { days, botsExcluded: bots, humanPrs: humans.length };
}

export async function collectPrFlow(repo) {
  const canonical = canonicalRepo(repo);
  const pulls = await allPulls(canonical);
  const flow = buildFlow(pulls);
  if (!flow) return null;
  return {
    repo: canonical,
    generatedAt: new Date().toISOString(),
    through: flow.days.at(-1)?.[0] ?? null,
    basis: "UTC days from each PR's own timestamps; bots excluded; day in progress omitted",
    ...flow,
  };
}

// Same unlocked set as vitals.mjs phase B and contributors.mjs: the house repo,
// every route repo owned by us, and the paying tenants.
function unlockedSet() {
  const config = readConfig();
  const owned = ((config.owned_by ?? [config.repo.split("/")[0]]) || []).map((o) => o.toLowerCase());
  const unlocked = new Set([canonicalRepo(config.repo).toLowerCase()]);
  try {
    const route = JSON.parse(readFileSync(join(DATA_DIR, "route.json"), "utf8"));
    for (const p of route?.repos ?? []) {
      if (p?.r && owned.includes(p.r.split("/")[0].toLowerCase())) unlocked.add(canonicalRepo(p.r).toLowerCase());
    }
  } catch {
    /* no route yet: the house repo alone */
  }
  const tenantsPath = join(DATA_DIR, "tenants.json");
  if (existsSync(tenantsPath)) {
    try {
      const t = JSON.parse(readFileSync(tenantsPath, "utf8"));
      for (const x of Array.isArray(t) ? t : []) unlocked.add(canonicalRepo(x.repo || x).toLowerCase());
    } catch {
      /* unreadable tenants: skip them, never abort the owned repos */
    }
  }
  return unlocked;
}

async function main() {
  token();
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) throw new Error("BLOB_READ_WRITE_TOKEN missing");
  const repos = process.argv.slice(2).length ? process.argv.slice(2) : [...unlockedSet()];
  for (const repo of repos) {
    const t0 = Date.now();
    let out;
    try {
      out = await collectPrFlow(repo);
    } catch (err) {
      console.error(`[prflow] ${repo} failed (non-fatal): ${err?.message ?? err}`);
      // the previous flow stays; leave the marker so the watchdog sees it
      await markPartial(`prflow--${canonicalRepo(repo).toLowerCase().replace("/", "--")}`, {
        repo, reason: String(err?.message ?? err).slice(0, 200),
      });
      continue;
    }
    if (!out) {
      console.log(`[prflow] ${repo}: no human PRs, nothing written`);
      continue;
    }
    const family = `prflow--${out.repo.toLowerCase().replace("/", "--")}`;
    const prev = await readFresh(prflowKey(out.repo));
    // a refused count that repeats EXACTLY on the next run is a real drop, not a cut-short pagination
    const pending = await readFresh(partialKey(family));
    const verdict = acceptPrCount(out.humanPrs, prev?.humanPrs ?? null, {
      pendingGot: pending && pending.resolved === false ? pending.got : null,
    });
    if (!verdict.ok) {
      await markPartial(family, { repo: out.repo, got: out.humanPrs, prev: prev?.humanPrs, reason: verdict.reason });
      console.log(`[prflow] ${out.repo}: NOT publishing, ${verdict.reason}. Keeping the previous flow.`);
      continue;
    }
    await put(prflowKey(out.repo), JSON.stringify(out), {
      access: "private",
      token: blobToken,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    await markComplete(family, { humanPrs: out.humanPrs });
    const last = out.days.at(-1);
    console.log(
      `[prflow] ${out.repo}: ${out.humanPrs} human PRs (${out.botsExcluded} bot) · ${out.days.length} days through ${out.through} · open ${last[4]} · median age ${last[5]}d · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("[prflow] failed:", e?.message || e);
    process.exit(0); // never break the collect run
  });
}
