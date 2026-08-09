// VITAL SIGNS — the living dashboard of a repo's engineering health. Star count
// says how big; vitals say whether anyone is still building, how fast, how well,
// and with whom. Distilled into one ALIVE / MONUMENT verdict, an activity
// fingerprint against the top of GitHub, DORA velocity, and the human engine
// behind it (contributors + the maintainer merge gate). Facts, not adjectives.
//
// Cache-only (like the Traffic Vault): a page view NEVER hits GitHub. The heavy
// work runs in collector/vitals.mjs and lands in the PRIVATE Blob at
// vitals/{owner}--{name}.json with every percentile baked in. Gating = presence:
// the collector only writes a file for OWNED repos (free) and PAID tenants, so a
// null here IS the lock — the UI shows the upsell. A paid repo lights up with no
// redeploy (runtime Blob read).
import { get } from "@vercel/blob";
import { unstable_cache } from "next/cache";

export interface VitalsActivity {
  commits30: number;
  prs30: number;
  issues30: number;
  releases90: number;
  v7: number;
  // percentile of each dimension vs the fixed top-N universe (0-100)
  commitsPct: number;
  prsPct: number;
  issuesPct: number;
  releasesPct: number;
  velocityPct: number;
  // composite (mean of the five) ranked against the composite distribution
  compositePct: number;
  compositeRank: number;
}

export interface VitalsLeadTime {
  medianH: number;
  p90H: number;
  tier: "Elite" | "High" | "Medium" | "Low"; // DORA, by median
  sample: number;
  pctUnder24h: number;
  pctUnder7d: number;
  windowDays?: number; // the window the median describes (a rate needs its window)
}

export interface VitalsDeploy {
  releases90: number;
  perWeek: number;
  tier: "Elite" | "High" | "Medium" | "Low";
}

export interface VitalsAdoption {
  cloneConvPct: number | null;
  uniqueClonersWeek: number | null;
  clonesPerCloner: number | null;
}

export interface VitalsCommunity {
  // repo-wide count, the same one github.com/{repo}/graphs/contributors shows,
  // because the panel links there and the two must not disagree
  contributors: number;
  contributorsSampled?: number; // unique human PR authors inside the sampled window
  mergedTotal?: number | null; // every merged PR ever
  prsSampled: number; // size of the window the lead time and merge gate come from
  mergedByDistinct: number; // 1 = single maintainer gate
  maintainers: string[]; // logins of the actual merge-gate keepers (bot-excluded)
  topContributors: { login: string }[]; // bot-excluded, most PRs first
  cohorts: { month: string; new: number; returning: number }[];
  cohortsSource?: string; // "commit-census" when the census supersedes the PR sample
  busFactor?: VitalsBusFactor | null;
  census?: VitalsCensus | null; // the evolution chart's data, embedded by vitals.mjs
}

// commit-share concentration, from the commit census (authored commits only)
export interface VitalsBusFactor {
  top1Share: number;
  top5Share: number;
  humans: number;
}

// daily cumulative contributor series from the commit census. Two readings:
// AUTHORS (strict) and CREDITED (authors + Co-authored-by humans, the same
// definition GitHub's own contributors box uses). AI co-credits are counted
// apart and never become people.
export interface VitalsCensus {
  authorsDaily: [string, number][];
  creditedDaily: [string, number][];
  authors: number;
  credited: number;
  aiCoCredits: number;
  measuredAt: string | null;
}

export interface VitalsCreator {
  login: string;
  followers: number | null;
}

// agent-readiness: file-existence only, from the public tree — is this repo
// agent-NATIVE (ships CLAUDE.md / AGENTS.md / .claude machinery / MCP), not just
// active. Zero owner-reported input.
export interface VitalsAgentReadiness {
  agentNative: boolean;
  claudeMd: boolean;
  agentsMd: boolean;
  skills: number;
  commands: number;
  subagents: number;
  mcp: boolean;
  cursorRules: number;
  chips: string[]; // ordered display tokens, e.g. ["CLAUDE.md","40 skills","MCP"]
  signals: number; // distinct signal categories present (0-7)
}

// merge quality, shown as ONE quiet stat: merged PRs whose title carries a
// revert, over all merged PRs, 90d. Public git history. A title-revert rate is a
// shallow, floor-heavy signal, so it is a footnote stat, never a ranked map.
export interface VitalsQuality {
  window: number; // days
  mergedPRs: number;
  reverts: number;
  revertPct: number;
}

// time-to-first-response (CHAOSS): median hours from an issue opened to the first
// maintainer reply, 90d. Attention scales, not just code. Public timeline.
export interface VitalsResponsiveness {
  medianH: number;
  p90H: number;
  sample: number;
  pctUnder24h: number;
  pctUnder48h: number;
}

// automation footprint: the unattended machinery, made visible. Public PR history.
export interface VitalsAutomation {
  statusChecksPerPR: number | null;
  botPRPct: number;
  bots: string[];
  sampled: number;
}

// docs / community health: GitHub's own community-health % + which files exist.
// The most-cited "beyond-code" maintainer signal. Public, one REST call.
export interface VitalsDocs {
  healthPct: number | null;
  readme: boolean;
  contributing: boolean;
  codeOfConduct: boolean;
  security: boolean;
  issueTemplate: boolean;
  prTemplate: boolean;
  license: boolean;
  chips: string[];
}

// onboarding: "good first issue" pool — the contributor funnel made visible.
// Newcomer retention comes from the PR cohorts.
//
// `free` is the signal; `goodFirstIssues` is only its denominator. An issue
// that already has an assignee or an open PR is not an entry point, so a big
// labeled count with a free count of 1 describes a CLOSED door with a lot of
// signage on it. Render free, never the total on its own.
//
// free is an upper bound: it cannot see issues claimed in the comments. null
// means the availability lookup failed - it does NOT mean "all of them".
export interface VitalsOnboarding {
  goodFirstIssues: number | null;
  goodFirstIssuesFree?: number | null;
}

export interface Vitals {
  repo: string;
  computedAt: string;
  universe: number;
  verdict: "ALIVE" | "MONUMENT";
  creator: VitalsCreator;
  activity: VitalsActivity;
  leadTime: VitalsLeadTime | null;
  deploy: VitalsDeploy | null;
  adoption: VitalsAdoption | null;
  community: VitalsCommunity | null;
  agentReadiness?: VitalsAgentReadiness | null;
  quality?: VitalsQuality | null;
  responsiveness?: VitalsResponsiveness | null;
  automation?: VitalsAutomation | null;
  docs?: VitalsDocs | null;
  onboarding?: VitalsOnboarding | null;
  createdAt?: string | null;
}

const blobKey = (repo: string) => `vitals/${repo.toLowerCase().replace("/", "--")}.json`;

async function readVitals(owner: string, name: string): Promise<Vitals | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    // useCache:false — @vercel/blob get() caches at the CDN (~1mo TTL) by
    // default, which would freeze the daily-rewritten vitals for weeks. The
    // 15-min unstable_cache below is the real dedup; each refresh reads fresh.
    const res = await get(blobKey(`${owner}/${name}`), { access: "private", token, useCache: false });
    if (res?.statusCode === 200 && res.stream) {
      return JSON.parse(await new Response(res.stream).text()) as Vitals;
    }
  } catch {
    /* missing (locked) or transient: the UI shows the upsell either way */
  }
  return null;
}

// One Blob read per repo per 15 min, shared across every consumer. Returns null
// for a locked repo — that null IS the gate.
export const loadVitals = (owner: string, name: string): Promise<Vitals | null> =>
  unstable_cache(
    () => readVitals(owner, name),
    // v8: onboarding carries goodFirstIssuesFree. BUMP THIS WHENEVER THE SHAPE
    // CHANGES - an entry cached under the old shape does not fail, it serves
    // the old reading, so a deploy that fixes a number ships looking like it
    // did nothing. v7 was itself a bump for the same reason (sample counts
    // passing for totals) and the lesson still cost 15 minutes today.
    ["vitals-v8", `${owner}/${name}`.toLowerCase()],
    { revalidate: 900 },
  )();
