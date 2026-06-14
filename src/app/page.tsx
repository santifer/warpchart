import Dashboard from "@/components/Dashboard";
import { buildBundle } from "@/lib/bundle";
import { getCachedDossier } from "@/lib/explorer";
import { loadMeta } from "@/lib/history";
import { fetchLiveSnapshot } from "@/lib/live-blob";
import { loadTrafficVault } from "@/lib/traffic";

// ISR every 60s: data/ (the heavy curve) is read at regeneration time from
// the committed snapshot, while the fresh "current state" rides the Vercel
// Blob (collector/live.mjs, no build). So the house console paints near
// real-time without a 2h jump, at the cost of a cheap per-minute regenerate.
export const revalidate = 60;

export default async function Home() {
  const repo = loadMeta()?.repo ?? "";
  const live = repo ? await fetchLiveSnapshot(repo) : null;
  const bundle = buildBundle(undefined, live);
  const [owner, name] = repo.split("/");
  const dossier = owner && name ? await getCachedDossier(owner, name) : null;
  const traffic = repo ? await loadTrafficVault(repo) : null;
  return <Dashboard bundle={bundle} dossier={dossier} traffic={traffic} />;
}
