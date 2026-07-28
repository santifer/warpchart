// Shared GitHub API helpers for the mission-control collectors.
// Zero dependencies: native fetch + node:fs only.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = join(ROOT, "data");

const API = "https://api.github.com";

// Tokens, best first. Not every token can do every job and you cannot tell by
// looking: GitHub's stargazer endpoints reject an Actions installation token
// ("Resource not accessible by integration") AND a fine-grained PAT ("...by
// personal access token", 403 on REST and GraphQL alike, even with public-repo
// read) while accepting a classic/OAuth one. Guessing which secret to configure
// froze the tenant's star series twice in one day, so the collector stops
// guessing: it carries every token it was given and, when one is FORBIDDEN for
// a call, retries that call with the next.
export function tokens() {
  const all = [
    process.env.GH_TOKEN,
    process.env.GH_TOKEN_FALLBACKS,
    process.env.GITHUB_TOKEN,
  ]
    .filter(Boolean)
    .flatMap((v) => v.split(/[\s,]+/))
    .filter(Boolean);
  const seen = new Set();
  const out = all.filter((t) => !seen.has(t) && seen.add(t));
  if (!out.length) {
    console.error("Missing GH_TOKEN / GITHUB_TOKEN env var");
    process.exit(1);
  }
  return out;
}

export function token() {
  return tokens()[0];
}

export function readConfig() {
  const cfg = JSON.parse(readFileSync(join(ROOT, "mission.config.json"), "utf8"));
  if (!cfg.repo || !/^[\w.-]+\/[\w.-]+$/.test(cfg.repo)) {
    throw new Error(`mission.config.json: "repo" must be "owner/name", got: ${cfg.repo}`);
  }
  return cfg;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Which token index is currently working. Sticky, so a permission failover
// costs one retry per process rather than one per call.
let tokenIdx = 0;

// Fetch with retries and rate-limit awareness.
export async function ghFetch(path, { method = "GET", body, tokenOverride = null } = {}) {
  const url = path.startsWith("http") ? path : API + path;
  const delays = [2000, 8000, 30000];
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        body: body ? JSON.stringify(body) : undefined,
        headers: {
          Authorization: `Bearer ${tokenOverride ?? tokens()[tokenIdx] ?? token()}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "mission-control",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch (err) {
      if (attempt >= delays.length) throw err;
      await sleep(delays[attempt]);
      continue;
    }
    if (res.ok) return res.json();
    if (attempt >= delays.length) {
      const text = (await res.text()).slice(0, 300);
      throw new Error(`GitHub ${res.status} on ${url}: ${text}`);
    }
    let wait = delays[attempt];
    if (res.status === 403 || res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      const reset = res.headers.get("x-ratelimit-reset");
      if (retryAfter) wait = Math.max(wait, (parseInt(retryAfter, 10) + 1) * 1000);
      else if (reset) wait = Math.max(wait, parseInt(reset, 10) * 1000 - Date.now() + 1000);
      wait = Math.min(wait, 120_000);
    }
    await sleep(wait);
  }
}

const isForbidden = (errors) =>
  Array.isArray(errors) && errors.some((e) => e?.type === "FORBIDDEN");

export async function graphql(query, variables) {
  const pool = tokens();
  let lastErrors = null;
  // GraphQL answers 200 with a FORBIDDEN error object rather than an HTTP 403,
  // so the permission failover has to live here, not in ghFetch's status check.
  for (let i = 0; i < pool.length; i++) {
    const idx = (tokenIdx + i) % pool.length;
    const data = await ghFetch("/graphql", {
      method: "POST", body: { query, variables }, tokenOverride: pool[idx],
    });
    if (!data.errors) {
      if (idx !== tokenIdx) {
        console.log(`[lib] token #${tokenIdx} is FORBIDDEN for this call, using #${idx} from now on`);
        tokenIdx = idx; // stick to the one that works
      }
      return data.data;
    }
    lastErrors = data.errors;
    if (!isForbidden(data.errors)) break; // a real query error: another token will not help
  }
  throw new Error("GraphQL: " + JSON.stringify(lastErrors).slice(0, 400));
}

// Search API is limited to 30 req/min: enforce a global gap between calls.
let lastSearchAt = 0;
export async function search(params) {
  const wait = lastSearchAt + 2100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastSearchAt = Date.now();
  return ghFetch("/search/repositories?" + new URLSearchParams(params));
}

// How many repos have strictly more stars than `stars`. Worldwide rank = countAbove + 1.
export async function countAbove(stars) {
  const r = await search({ q: `stars:>${stars}`, per_page: "1" });
  return r.total_count;
}

export async function repoMeta(owner, name) {
  const data = await graphql(
    `query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        nameWithOwner description stargazerCount forkCount createdAt homepageUrl
        owner{ login avatarUrl }
        primaryLanguage{ name }
      }
    }`,
    { owner, name }
  );
  if (!data.repository) throw new Error(`Repository not found: ${owner}/${name}`);
  return data.repository;
}

const STARGAZERS_QUERY = `query($owner:String!,$name:String!,$before:String){
  repository(owner:$owner,name:$name){
    stargazerCount
    stargazers(last:100, before:$before){
      pageInfo{ startCursor hasPreviousPage }
      edges{ starredAt }
    }
  }
}`;

// Walk stargazers backwards from the most recent. Edges within a page come
// ordered ascending by starredAt. Returns ascending ISO timestamps.
// stopAfter: keep only timestamps strictly newer than this ISO string and
// stop paging once we cross it. maxPages caps the walk (Infinity = full).
export async function backwalk(owner, name, { stopAfter = null, maxPages = Infinity, onProgress = null, pageDelayMs = 120 } = {}) {
  let before = null;
  let pages = 0;
  let stars = null;
  let complete = false;
  const chunks = [];
  while (pages < maxPages) {
    const data = await graphql(STARGAZERS_QUERY, { owner, name, before });
    const repo = data.repository;
    if (!repo) throw new Error(`Repository not found: ${owner}/${name}`);
    stars = repo.stargazerCount;
    const { pageInfo, edges } = repo.stargazers;
    pages++;
    const ts = edges.map((e) => e.starredAt);
    chunks.push(ts);
    if (onProgress) onProgress(pages, ts[0] ?? null);
    if (stopAfter && ts.length && ts[0] <= stopAfter) { complete = true; break; }
    if (!pageInfo.hasPreviousPage) { complete = true; break; }
    before = pageInfo.startCursor;
    if (pageDelayMs) await sleep(pageDelayMs);
  }
  const all = chunks.reverse().flat();
  const timestamps = stopAfter ? all.filter((t) => t > stopAfter) : all;
  timestamps.sort();
  return { timestamps, stars, complete, pages };
}

// Next round-number rank milestones below the current rank.
// rank 409 -> [400, 300, 200, 100]; rank 101 -> [100, 90, 80, 70]; rank 4870 -> [4000, 3000, 2000, 1000].
export function nextMilestones(rank, count = 4) {
  if (!Number.isFinite(rank) || rank <= 1) return [];
  const out = [];
  let unit = Math.pow(10, Math.floor(Math.log10(rank - 1)));
  let m = Math.floor((rank - 1) / unit) * unit;
  while (out.length < count && m >= 1) {
    out.push(m);
    if (m - unit < 1 && unit > 1) unit = unit / 10;
    m -= unit;
  }
  return out;
}

// The galactic core: the #1 most-starred repo in the world.
export async function apexRepo() {
  const r = await search({ q: "stars:>100000", sort: "stars", order: "desc", per_page: "1" });
  const item = r.items?.[0];
  return item ? { r: item.full_name, s: item.stargazers_count } : null;
}

// The worldwide top 1000 (search enumeration cap), used as route landmarks
// and as the population for fork-ratio percentiles. 10 search calls.
export async function topRepos() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = await search({
      q: "stars:>10000", sort: "stars", order: "desc", per_page: "100", page: String(page),
    });
    for (const item of r.items ?? []) {
      out.push({
        r: item.full_name,
        s: item.stargazers_count,
        d: item.description ? item.description.slice(0, 160) : null,
        l: item.language ?? null,
        f: item.forks_count ?? 0,
        t: (item.topics ?? []).slice(0, 8),
        c: item.created_at ?? null,
      });
    }
  }
  return out;
}

// The worldwide top N (default 10,000) for the rank-distribution moat. Search
// caps each query at 1000 results, so we walk DESCENDING star windows: each
// window lowers the upper bound to the lowest star count seen so far and dedups
// by name across the boundary overlap. ~N/1000 windows x up to 10 pages
// (~100 search calls for 10k, ~3.5 min at the 30/min search limit). Best-effort:
// returns whatever it gathered if a window fails.
export async function topReposDeep(limit = 10000) {
  const out = [];
  const seen = new Set();
  let hi = null; // null = no upper bound (start at the very top)
  const maxWindows = Math.ceil(limit / 1000) + 4;
  for (let win = 0; win < maxWindows && out.length < limit; win++) {
    const q = hi === null ? "stars:>1000" : `stars:1000..${hi}`;
    let added = 0;
    try {
      for (let page = 1; page <= 10 && out.length < limit; page++) {
        const r = await search({
          q, sort: "stars", order: "desc", per_page: "100", page: String(page),
        });
        const items = r.items ?? [];
        for (const item of items) {
          if (seen.has(item.full_name)) continue;
          seen.add(item.full_name);
          out.push({
            r: item.full_name,
            s: item.stargazers_count,
            d: item.description ? item.description.slice(0, 160) : null,
            l: item.language ?? null,
            f: item.forks_count ?? 0,
            t: (item.topics ?? []).slice(0, 8),
            c: item.created_at ?? null,
          });
          added++;
        }
        if (items.length < 100) break; // window exhausted before 1000
      }
    } catch (err) {
      console.error(`[topReposDeep] window ${win} (hi=${hi}) failed: ${err.message}`);
      break; // return what we gathered so far
    }
    if (!added) break; // no new repos -> done
    hi = out[out.length - 1].s; // next window starts at the lowest star count seen
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, limit);
}

// ---- Spike forensics: correlate star spikes with HN posts, Reddit posts
// and the repo's own releases. External APIs are free and unauthenticated.

async function getJsonQuiet(url, headers = {}) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "mission-control", ...headers } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function dailyCountsFromTimestamps(lines) {
  const counts = new Map();
  for (const iso of lines) {
    const d = iso.slice(0, 10);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

export async function buildForensics(repoFull, timestampLines) {
  const [owner, name] = repoFull.split("/");
  const daily = dailyCountsFromTimestamps(timestampLines);

  // spike days: well above the trailing week, or all-time top 3
  const spikes = [];
  for (let i = 0; i < daily.length; i++) {
    const [day, c] = daily[i];
    const prior = daily.slice(Math.max(0, i - 7), i).map((x) => x[1]).sort((a, b) => a - b);
    const median = prior.length ? prior[Math.floor(prior.length / 2)] : 0;
    if (c > Math.max(60, median * 2.5)) spikes.push({ day, c });
  }
  const topDays = [...daily].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([day, c]) => ({ day, c }));
  const byDay = new Map();
  for (const s of [...spikes, ...topDays]) byDay.set(s.day, s.c);
  const targets = [...byDay.entries()]
    .map(([day, c]) => ({ day, c }))
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, 8);

  // releases once for all spikes
  let releases = [];
  try {
    const rel = await ghFetch(`/repos/${owner}/${name}/releases?per_page=100`);
    releases = (rel ?? []).map((x) => ({
      tag: x.tag_name,
      at: x.published_at,
      url: x.html_url,
    }));
  } catch { /* repos without releases */ }

  const out = [];
  for (const t of targets) {
    const t0 = Math.floor(Date.parse(t.day + "T00:00:00Z") / 1000) - 86400;
    const t1 = t0 + 3 * 86400;
    const causes = [];

    const hn = await getJsonQuiet(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(name)}&numericFilters=created_at_i>${t0},created_at_i<${t1}&hitsPerPage=5`
    );
    for (const h of (hn?.hits ?? []).slice(0, 2)) {
      if ((h.points ?? 0) < 10) continue;
      causes.push({
        type: "hn",
        title: h.title ?? "Hacker News post",
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        points: h.points ?? 0,
      });
    }

    const rd = await getJsonQuiet(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(`"${name}"`)}&sort=top&limit=25&t=all`
    );
    const rdHits = (rd?.data?.children ?? [])
      .map((x) => x.data)
      .filter((p) => p.created_utc >= t0 && p.created_utc <= t1 && (p.score ?? 0) >= 50)
      .sort((a, b) => b.score - a.score)
      .slice(0, 1);
    for (const p of rdHits) {
      causes.push({
        type: "reddit",
        title: `r/${p.subreddit}: ${p.title}`,
        url: `https://www.reddit.com${p.permalink}`,
        points: p.score,
      });
    }

    for (const rel of releases) {
      const at = Date.parse(rel.at ?? "") / 1000;
      if (at >= t0 && at <= t1) {
        causes.push({ type: "release", title: `release ${rel.tag}`, url: rel.url, points: null });
      }
    }

    causes.sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    out.push({ date: t.day, stars: t.c, causes: causes.slice(0, 3) });
  }
  return out;
}

// Star count of the repo at worldwide rank `rank`.
// Ranks <= 1000 are read directly from search pages (exact). Deeper ranks use
// a binary search over countAbove (total_count is not capped).
export async function thresholdForRank(rank, ownStars) {
  if (rank <= 1000) {
    const page = Math.ceil(rank / 100);
    const idx = (rank - 1) % 100;
    const r = await search({ q: "stars:>10000", sort: "stars", order: "desc", per_page: "100", page: String(page) });
    const item = r.items?.[idx];
    if (item) return item.stargazers_count;
  }
  let lo = 1;
  let hi = Math.max(ownStars * 2, 2000);
  while ((await countAbove(hi)) >= rank) hi *= 2;
  let best = lo;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const c = await countAbove(mid);
    if (c >= rank) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best;
}

// Nearest ranking neighbors: ~`above` repos just above our star count and
// ~`below` just below. Returns full names ordered by stars ascending.
export async function findNeighbors(ownFullName, stars, { above = 15, below = 5 } = {}) {
  const deltaHi = Math.max(Math.ceil(stars * 0.12), 200);
  const deltaLo = Math.max(Math.ceil(stars * 0.06), 100);
  const up = await search({
    q: `stars:${stars + 1}..${stars + deltaHi}`,
    sort: "stars", order: "asc", per_page: String(Math.min(above + 10, 50)),
  });
  const down = await search({
    q: `stars:${Math.max(1, stars - deltaLo)}..${stars}`,
    sort: "stars", order: "desc", per_page: String(below + 5),
  });
  const upNames = (up.items ?? [])
    .filter((i) => i.full_name !== ownFullName)
    .slice(0, above)
    .map((i) => i.full_name);
  const downNames = (down.items ?? [])
    .filter((i) => i.full_name !== ownFullName)
    .slice(0, below)
    .map((i) => i.full_name);
  return [...downNames.reverse(), ...upNames];
}

// Recent velocity (stars/day over the last 100 stars) for up to ~25 repos in
// ONE GraphQL request using aliases. Includes description and language for
// the hover scan cards.
export async function reposVelocity(fullNames, now = new Date()) {
  if (!fullNames.length) return [];
  const parts = fullNames.map((fn, i) => {
    const [o, n] = fn.split("/");
    return `r${i}: repository(owner:${JSON.stringify(o)}, name:${JSON.stringify(n)}){
      nameWithOwner stargazerCount description primaryLanguage{ name }
      stargazers(last:100){ edges{ starredAt } } }`;
  });
  const data = await graphql(`{ ${parts.join("\n")} }`);
  const out = [];
  for (let i = 0; i < fullNames.length; i++) {
    const d = data[`r${i}`];
    if (!d) continue;
    const edges = d.stargazers.edges;
    // UNKNOWN is not ZERO. Since GitHub closed stargazer listing for repos we
    // do not own, this query returns an EMPTY edges array instead of an error,
    // and reading that as "grew by 0" published a measured-looking zero for
    // every neighbour of the tenant. A repo with 61,000 stars did not stop
    // growing; we simply lost the window to see it. Null says so, and the
    // caller substitutes the canonical 7-day rate from the registry.
    let v = edges.length >= 2 ? 0 : d.stargazerCount > 0 ? null : 0;
    if (edges.length >= 2) {
      const oldest = new Date(edges[0].starredAt);
      // Floor only guards near-simultaneous timestamps (div-by-~0); keep it
      // tiny, since edges.length / floor is the implicit velocity ceiling.
      // 0.01 (14.4 min) capped this at 100 / 0.01 = 10000 stars/day; 2 min
      // lifts it to ~72000/day, past any real sustained pace.
      const MIN_SPAN_DAYS = 2 / 1440; // 2 minutes
      const days = Math.max((now - oldest) / 864e5, MIN_SPAN_DAYS);
      v = edges.length / days;
    }
    out.push({
      r: d.nameWithOwner,
      s: d.stargazerCount,
      v: v === null ? null : Math.round(v * 10) / 10,
      d: d.description ? d.description.slice(0, 90) : null,
      l: d.primaryLanguage?.name ?? null,
    });
  }
  return out;
}
