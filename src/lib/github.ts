// Live GitHub helpers for the API routes. Single-attempt (serverless time
// budget); the client treats failures as transient and keeps polling.
const API = "https://api.github.com";

function token(): string {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!t) throw new Error("Missing GITHUB_TOKEN env var");
  return t;
}

async function ghFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(API + path, {
    method: init?.method ?? "GET",
    body: init?.body ? JSON.stringify(init.body) : undefined,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "mission-control",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const data = await ghFetch<{ data: T; errors?: unknown[] }>("/graphql", {
    method: "POST",
    body: { query, variables },
  });
  if (data.errors) throw new Error("GraphQL: " + JSON.stringify(data.errors).slice(0, 300));
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

// One aliased GraphQL query: recent velocity for up to ~25 repos, plus
// description and language for the hover scan cards.
export async function neighborsVelocity(
  fullNames: string[],
  now = Date.now()
): Promise<{ r: string; s: number; v: number; d: string | null; l: string | null }[]> {
  if (!fullNames.length) return [];
  const parts = fullNames.slice(0, 25).map((fn, i) => {
    const [o, n] = fn.split("/");
    return `r${i}: repository(owner:${JSON.stringify(o)}, name:${JSON.stringify(n)}){
      nameWithOwner stargazerCount description primaryLanguage{ name }
      stargazers(last:100){ edges{ starredAt } } }`;
  });
  const data = await graphql<Record<string, {
    nameWithOwner: string;
    stargazerCount: number;
    description: string | null;
    primaryLanguage: { name: string } | null;
    stargazers: { edges: { starredAt: string }[] };
  } | null>>(`{ ${parts.join("\n")} }`);
  const out: { r: string; s: number; v: number; d: string | null; l: string | null }[] = [];
  for (let i = 0; i < Math.min(fullNames.length, 25); i++) {
    const d = data[`r${i}`];
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
  return out;
}
