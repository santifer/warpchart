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
  contributors: number; // unique human PR authors (bots excluded)
  prsSampled: number;
  mergedByDistinct: number; // 1 = single maintainer gate
  maintainers: string[]; // logins of the actual merge-gate keepers (bot-excluded)
  topContributors: { login: string }[]; // bot-excluded, most PRs first
  cohorts: { month: string; new: number; returning: number }[];
}

export interface VitalsCreator {
  login: string;
  followers: number | null;
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
    ["vitals-v2", `${owner}/${name}`.toLowerCase()],
    { revalidate: 900 },
  )();
