import Dashboard from "@/components/Dashboard";
import { buildBundle } from "@/lib/bundle";

// Fully static: data/ is read at build time. The hourly collector commit
// triggers a redeploy, so this page is never more than ~1h behind; the
// client live layer covers the gap.
export const dynamic = "force-static";

export default function Home() {
  const bundle = buildBundle();
  return <Dashboard bundle={bundle} />;
}
