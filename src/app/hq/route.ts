// Legacy alias: the tracked repo's console now lives on its natural route
// (/r/owner/name, same template as every repo, just unlocked). Old links
// and published embeds keep working through this 308.
import { loadMeta } from "@/lib/history";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const meta = loadMeta();
  return Response.redirect(new URL(meta ? `/r/${meta.repo}` : "/", req.url), 308);
}
