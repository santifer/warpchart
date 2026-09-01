// Legacy alias: the tracked repo's console now lives on its natural route
// (/r/owner/name, same template as every repo, just unlocked). Old links
// and published embeds keep working through this 308.
import { loadMeta } from "@/lib/history";
import { canonicalRepo } from "@/lib/aliases";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const meta = loadMeta();
  // canonicalRepo: until the collector's first post-rename run, meta.json still
  // carries the old name — resolve it here or this 308 chains into a second one.
  return Response.redirect(new URL(meta ? `/r/${canonicalRepo(meta.repo)}` : "/", req.url), 308);
}
