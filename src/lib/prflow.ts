// PR FLOW — what enters and what leaves a repo's pull-request queue, per UTC
// day, with the open queue at each day's close. Computed by collector/prflow.mjs
// from each PR's own timestamps (so a missed collector run cannot invent a zero
// day) and written to the PRIVATE Blob at prflow/{owner}--{name}.json.
//
// Same contract as vitals.ts: a page view NEVER hits GitHub, and gating is
// presence. The collector only writes the file for the unlocked set, so null
// here means "not tracked" and the panel simply does not render. It is public
// on an unlocked page (it is public GitHub data), unlike the Traffic Vault.
import { get } from "@vercel/blob";
import { unstable_cache } from "next/cache";
import { allNamesOf } from "./aliases";

// [day, opened, merged, closedUnmerged, openAtClose, medianAgeDaysOfOpen]
export type PrFlowDay = [string, number, number, number, number, number | null];

export interface PrFlow {
  repo: string;
  generatedAt: string;
  through: string | null;
  basis: string;
  days: PrFlowDay[];
  botsExcluded: number;
  humanPrs: number;
}

const blobKey = (repo: string) => `prflow/${repo.toLowerCase().replace("/", "--")}.json`;

async function readPrFlow(owner: string, name: string): Promise<PrFlow | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  // rewritten on every run (a full recompute, not an accumulation), so a renamed
  // repo only needs the newest name first and older names as fallback
  for (const rn of [...allNamesOf(`${owner}/${name}`)].reverse()) {
    try {
      // useCache:false: the Blob CDN would otherwise freeze a rewritten file for
      // weeks; the 15-min unstable_cache below is the real dedup
      const res = await get(blobKey(rn), { access: "private", token, useCache: false });
      if (res?.statusCode === 200 && res.stream) {
        const flow = JSON.parse(await new Response(res.stream).text()) as PrFlow;
        return flow.days?.length ? flow : null;
      }
    } catch {
      /* missing (not tracked) or transient: try the next historical name */
    }
  }
  return null;
}

// BUMP THE KEY WHENEVER THE SHAPE CHANGES: an entry cached under the old shape
// does not fail, it serves the old reading.
export const loadPrFlow = (owner: string, name: string): Promise<PrFlow | null> =>
  unstable_cache(() => readPrFlow(owner, name), ["prflow-v1", `${owner}/${name}`.toLowerCase()], {
    revalidate: 900,
  })();
