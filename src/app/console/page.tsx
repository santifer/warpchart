// The mission console has ONE template and ONE home: /r/{owner}/{name}, whose
// tenant branch renders the full Dashboard. /console is kept only as a stable
// alias that redirects there, so there are no two divergent console templates
// and self-hosted forks still land on their own house repo (loadMeta().repo).
import { redirect } from "next/navigation";
import { loadMeta } from "@/lib/history";

// Dynamic, not a baked static 307: the redirect target is derived from
// loadMeta() per request, so it is never frozen to a build-time value (e.g. a
// sample-seeded build) with no runtime recovery.
export const dynamic = "force-dynamic";

export default async function Console() {
  const repo = loadMeta()?.repo;
  redirect(repo ? `/r/${repo}` : "/");
}
