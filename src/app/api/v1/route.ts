// Public, free, read-only growth-telemetry API over GitHub's worldwide top-1000
// registry. Cache-only (zero GitHub calls). This index is self-documenting so
// an agent (or human) can discover the surface from the base URL.
import { registryMeta, SITE } from "@/lib/api-v1";
import { API_ENDPOINTS } from "@/lib/surface";

export const dynamic = "force-dynamic";
const CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";

export async function GET() {
  const body = {
    name: "Warpchart API",
    version: "v1",
    description:
      "Free, read-only growth telemetry over GitHub's worldwide top-1000 repositories: rank, star velocity, ranking neighbours and imminent overtakes. Public data, refreshed daily.",
    registry: registryMeta(),
    endpoints: Object.fromEntries(API_ENDPOINTS.map((e) => [e.sig, e.desc])),
    mcp: `${SITE}/api/mcp`,
    docs: `${SITE}/docs`,
    terms:
      "Public GitHub data, free to use. Per-repository historical telemetry (hourly history, traffic, attribution) is a separate hosted product.",
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE } });
}
