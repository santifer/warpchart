// Live GitHub helpers for the API routes. Single-attempt (serverless time
// budget); the client treats failures as transient and keeps polling.
import { reqLog, serializeError } from "@/lib/log";

const API = "https://api.github.com";
const ghlog = reqLog("github");

function token(): string {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!t) throw new Error("Missing GITHUB_TOKEN env var");
  return t;
}

// GitHub returns transient 502s now and then; retry briefly (the budget is
// fine: these routes are ISR/edge-cached, not user-blocking).
async function ghFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown; accept?: string }
): Promise<T> {
  const delays = [400, 900, 2000];
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(API + path, {
        method: init?.method ?? "GET",
        body: init?.body ? JSON.stringify(init.body) : undefined,
        headers: {
          Authorization: `Bearer ${token()}`,
          Accept: init?.accept ?? "application/vnd.github+json",
          "User-Agent": "mission-control",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
        // No explicit cache mode: fetch is uncached by default in Next 15+,
        // and an explicit "no-store" would force the ISR explorer page into
        // fully dynamic rendering (killing its cache).
      });
    } catch (err) {
      if (attempt >= delays.length) throw err;
    }
    if (res?.ok) {
      const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? NaN);
      if (remaining < 300) {
        ghlog.warn("ratelimit.low", { path: path.slice(0, 80), remaining,
          reset: res.headers.get("x-ratelimit-reset") });
      }
      return res.json() as Promise<T>;
    }
    const retriable = !res || res.status >= 500;
    if (!retriable || attempt >= delays.length) {
      ghlog.error("fetch.failed", undefined, { path: path.slice(0, 120),
        status: res?.status ?? "network", attempts: attempt + 1 });
      throw new Error(`GitHub ${res?.status ?? "network"}: ${res ? (await res.text()).slice(0, 200) : ""}`);
    }
    ghlog.warn("fetch.retry", { path: path.slice(0, 80), status: res?.status ?? "network", attempt: attempt + 1 });
    await new Promise((r) => setTimeout(r, delays[attempt]));
  }
}

export async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const data = await ghFetch<{ data: T | null; errors?: { type?: string; message?: string }[] }>(
    "/graphql",
    { method: "POST", body: { query, variables } }
  );
  if (data.errors?.length) {
    // GitHub returns PARTIAL errors (e.g. NOT_FOUND for one renamed repo in
    // an aliased batch) alongside perfectly good data for the rest. Throwing
    // here used to poison whole pages into degraded 0/day velocity. Only
    // throw when there is no usable data at all.
    const kinds = [...new Set(data.errors.map((e) => e.type ?? "UNKNOWN"))];
    if (data.data == null) {
      ghlog.error("graphql.failed", undefined, { kinds, sample: data.errors[0]?.message?.slice(0, 160) });
      throw new Error("GraphQL: " + JSON.stringify(data.errors).slice(0, 300));
    }
    ghlog.warn("graphql.partial", { errors: data.errors.length, kinds });
  }
  if (data.data == null) throw new Error("GraphQL: empty data");
  return data.data;
}

export async function currentStars(owner: string, name: string): Promise<number> {
  const d = await graphql<{ repository: { stargazerCount: number } | null }>(
    `query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ stargazerCount } }`,
    { owner, name }
  );
  if (!d.repository) throw new Error("repository not found");
  return d.repository.stargazerCount;
}

export interface RepoLite {
  nameWithOwner: string;
  stargazerCount: number;
  forkCount: number;
  description: string | null;
  primaryLanguage: { name: string } | null;
}

export async function repoLite(owner: string, name: string): Promise<RepoLite> {
  const d = await graphql<{ repository: RepoLite | null }>(
    `query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        nameWithOwner stargazerCount forkCount description primaryLanguage{ name }
      }
    }`,
    { owner, name }
  );
  if (!d.repository) throw new Error("repository not found");
  return d.repository;
}

// Nearest ranking neighbors via the search API (for repos outside the
// precomputed top 1000). Two search calls.
export async function searchNeighbors(
  ownFullName: string,
  stars: number,
  { above = 15, below = 5 } = {}
): Promise<string[]> {
  const deltaHi = Math.max(Math.ceil(stars * 0.12), 200);
  const deltaLo = Math.max(Math.ceil(stars * 0.06), 100);
  const up = await ghFetch<{ items?: { full_name: string }[] }>(
    `/search/repositories?q=${encodeURIComponent(`stars:${stars + 1}..${stars + deltaHi}`)}&sort=stars&order=asc&per_page=${Math.min(above + 10, 50)}`
  );
  const down = await ghFetch<{ items?: { full_name: string }[] }>(
    `/search/repositories?q=${encodeURIComponent(`stars:${Math.max(1, stars - deltaLo)}..${stars}`)}&sort=stars&order=desc&per_page=${below + 5}`
  );
  const own = ownFullName.toLowerCase();
  const upNames = (up.items ?? [])
    .filter((i) => i.full_name.toLowerCase() !== own)
    .slice(0, above)
    .map((i) => i.full_name);
  const downNames = (down.items ?? [])
    .filter((i) => i.full_name.toLowerCase() !== own)
    .slice(0, below)
    .map((i) => i.full_name);
  return [...downNames.reverse(), ...upNames];
}

export async function worldwideRank(stars: number): Promise<number> {
  const r = await ghFetch<{ total_count: number }>(
    `/search/repositories?q=${encodeURIComponent(`stars:>${stars}`)}&per_page=1`
  );
  return r.total_count + 1;
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

interface StargazersResp {
  repository: {
    stargazerCount: number;
    stargazers: {
      pageInfo: { startCursor: string; hasPreviousPage: boolean };
      edges: { starredAt: string }[];
    };
  } | null;
}

// Timestamps strictly newer than `stopAfter`, ascending. Capped at maxPages.
export async function backwalkSince(
  owner: string,
  name: string,
  stopAfter: string,
  maxPages = 10
): Promise<{ timestamps: string[]; stars: number; complete: boolean }> {
  let before: string | null = null;
  let stars = 0;
  let complete = false;
  const chunks: string[][] = [];
  for (let page = 0; page < maxPages; page++) {
    const d: StargazersResp = await graphql<StargazersResp>(STARGAZERS_QUERY, { owner, name, before });
    if (!d.repository) throw new Error("repository not found");
    stars = d.repository.stargazerCount;
    const { pageInfo, edges } = d.repository.stargazers;
    const ts = edges.map((e) => e.starredAt);
    chunks.push(ts);
    if (ts.length && ts[0] <= stopAfter) { complete = true; break; }
    if (!pageInfo.hasPreviousPage) { complete = true; break; }
    before = pageInfo.startCursor;
  }
  const timestamps = chunks.reverse().flat().filter((t) => t > stopAfter);
  timestamps.sort();
  return { timestamps, stars, complete };
}

// Velocity for up to ~25 repos. CHUNKED into small aliased queries: a
// single 25-alias query with stargazer edges is heavy enough that GitHub's
// GraphQL executor times it out under load (intermittent 502s after
// retries, observed in production via fetch.failed traces) and every page
// degraded to 0/day. Seven aliases with last:50 resolve fast and reliably,
// chunks run in parallel and individual chunk failures only cost their own
// repos, never the whole page.
interface VelocityRepoNode {
  nameWithOwner: string;
  stargazerCount: number;
  description: string | null;
  primaryLanguage: { name: string } | null;
  stargazers: { edges: { starredAt: string }[] };
}

export async function neighborsVelocity(
  fullNames: string[],
  now = Date.now()
): Promise<{ r: string; s: number; v: number; d: string | null; l: string | null }[]> {
  if (!fullNames.length) return [];
  const names = fullNames.slice(0, 25);
  const CHUNK = 7;
  const chunks: string[][] = [];
  for (let i = 0; i < names.length; i += CHUNK) chunks.push(names.slice(i, i + CHUNK));

  const runChunk = async (chunk: string[]) => {
    const parts = chunk.map((fn, i) => {
      const [o, n] = fn.split("/");
      return `r${i}: repository(owner:${JSON.stringify(o)}, name:${JSON.stringify(n)}){
        nameWithOwner stargazerCount description primaryLanguage{ name }
        stargazers(last:50){ edges{ starredAt } } }`;
    });
    return graphql<Record<string, VelocityRepoNode | null>>(`{ ${parts.join("\n")} }`);
  };

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        return await runChunk(chunk);
      } catch {
        // one quiet beat and a single retry: a stressed GraphQL executor
        // usually recovers within a second, and this turns the rare
        // all-chunks-down render into a non-event
        await new Promise((r) => setTimeout(r, 900));
        try {
          return await runChunk(chunk);
        } catch (err) {
          ghlog.warn("velocity.chunk-failed", { size: chunk.length, ...serializeError(err) });
          return null;
        }
      }
    })
  );

  const out: { r: string; s: number; v: number; d: string | null; l: string | null }[] = [];
  for (const data of results) {
    if (!data) continue;
    for (const d of Object.values(data)) {
      if (!d) continue;
      const edges = d.stargazers.edges;
      let v = 0;
      if (edges.length >= 2) {
        const days = Math.max((now - Date.parse(edges[0].starredAt)) / 864e5, 0.01);
        v = edges.length / days;
      }
      out.push({
        r: d.nameWithOwner,
        s: d.stargazerCount,
        v: Math.round(v * 10) / 10,
        d: d.description ? d.description.slice(0, 90) : null,
        l: d.primaryLanguage?.name ?? null,
      });
    }
  }
  // every chunk failed: let callers run their degraded path
  if (!out.length && names.length) throw new Error("neighborsVelocity: all chunks failed");
  return out;
}

// Free-text repository search for the explore landing. One REST call,
// cached upstream (unstable_cache + edge headers in the API route).
export async function searchRepos(
  q: string,
  limit = 6
): Promise<{ r: string; s: number; d: string | null }[]> {
  const res = await ghFetch<{
    items?: { full_name: string; stargazers_count: number; description: string | null }[];
  }>(`/search/repositories?q=${encodeURIComponent(q)}&per_page=${limit}&sort=stars&order=desc`);
  return (res.items ?? []).map((i) => ({
    r: i.full_name,
    s: i.stargazers_count,
    d: i.description ? i.description.slice(0, 90) : null,
  }));
}

// REST basics for the embeddable chart of arbitrary repos.
export async function repoBasic(
  owner: string,
  name: string
): Promise<{ r: string; s: number; created: string }> {
  const d = await ghFetch<{ full_name: string; stargazers_count: number; created_at: string }>(
    `/repos/${owner}/${name}`
  );
  return { r: d.full_name, s: d.stargazers_count, created: d.created_at };
}

// First starred_at of a given stargazer page (100/page, ascending order).
// Sampling spaced pages reconstructs the cumulative curve the same way
// star-history does; the REST API caps pagination at page 400 (40K stars).
export async function stargazerPageFirst(
  owner: string,
  name: string,
  page: number
): Promise<string | null> {
  const items = await ghFetch<{ starred_at: string }[]>(
    `/repos/${owner}/${name}/stargazers?per_page=100&page=${page}`,
    { accept: "application/vnd.github.star+json" }
  );
  return items.length ? items[0].starred_at : null;
}
