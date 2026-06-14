// Public, free, read-only growth-telemetry API over GitHub's worldwide top-1000
// registry. Cache-only (zero GitHub calls). This index is self-documenting so
// an agent (or human) can discover the surface from the base URL.
import { registryMeta, SITE } from "@/lib/api-v1";

export const dynamic = "force-dynamic";
const CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";

export async function GET() {
  const body = {
    name: "Warpchart API",
    version: "v1",
    description:
      "Free, read-only growth telemetry over GitHub's worldwide top-1000 repositories: rank, star velocity, ranking neighbours and imminent overtakes. Public data, refreshed daily.",
    registry: registryMeta(),
    endpoints: {
      "GET /api/v1/repo?repo=owner/name":
        "Worldwide rank, stars, velocity, ranking neighbours and the next milestone gate for a repo in the top-1000 registry.",
      "GET /api/v1/leaderboard?limit=20&language=Rust":
        "The biggest repositories by stars, optionally filtered to one language.",
      "GET /api/v1/velocity?limit=20&language=Rust":
        "The fastest-growing repositories right now (stars/day), optionally by language.",
      "GET /api/v1/rising":
        "The rising-by-category directory: every domain (AI, CLI, databases, frontend, security, by language and more) ordered by momentum. Add ?topic=ai-llm for the repos climbing fastest in one category, or ?language=Rust.",
      "GET /api/v1/find?q=agentic+memory+system":
        "Natural-language repository recommendation. Ask 'what is the best X?' and get the catalog repos that match the intent, ranked by validation (stars) and momentum (velocity).",
      "GET /api/v1/overtakes?limit=20":
        "Imminent rank overtakes globally. Add ?repo=owner/name to get who is hunting THAT repo and who it is about to pass.",
      "GET /api/v1/compare?repos=a/b,c/d": "Side-by-side stats for up to 10 repos.",
      "GET /api/v1/embed?repo=owner/name": "An animated star-history chart embed snippet (markdown + HTML) for your README.",
    },
    mcp: `${SITE}/api/mcp`,
    docs: SITE,
    terms:
      "Public GitHub data, free to use. Per-repository historical telemetry (hourly history, traffic, attribution) is a separate hosted product.",
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE } });
}
