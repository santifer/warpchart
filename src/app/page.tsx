import Dashboard from "@/components/Dashboard";
import { buildBundle } from "@/lib/bundle";
import { getCachedDossier } from "@/lib/explorer";
import { loadMeta } from "@/lib/history";

// Fully static: data/ is read at build time. The hourly collector commit
// triggers a redeploy, so this page is never more than ~1h behind; the
// client live layer covers the gap.
export const dynamic = "force-static";

export default async function Home() {
  const bundle = buildBundle();
  const [owner, name] = (loadMeta()?.repo ?? "").split("/");
  const dossier = owner && name ? await getCachedDossier(owner, name) : null;
  return <Dashboard bundle={bundle} dossier={dossier} />;
}
