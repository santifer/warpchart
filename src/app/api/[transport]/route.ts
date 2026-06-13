// Warpchart MCP server — public, read-only growth telemetry for agents, over
// the SAME cache-only layer as /api/v1 (zero GitHub calls). Streamable HTTP at
// /api/mcp (the [transport] segment also serves /api/sse). Static /api/* routes
// take precedence over this dynamic segment, so it only catches mcp/sse.
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  repoStats,
  velocityRanking,
  overtakes,
  compareRepos,
  embedSnippet,
  registryMeta,
} from "@/lib/api-v1";

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "get_repo_stats",
      {
        title: "Get repository stats",
        description:
          "Worldwide GitHub rank, star count, stars/day velocity, ranking neighbours and the next milestone gate for a repository in the worldwide top-1000 registry. Use the canonical 'owner/name' (e.g. react/react, not facebook/react). Returns not-in-registry if outside the top 1000.",
        inputSchema: { repo: z.string().describe("owner/name, e.g. tinygrad/tinygrad") },
      },
      async ({ repo }) => {
        const stats = repoStats(repo);
        return json(
          stats
            ? { ...stats, registry: registryMeta() }
            : { error: "not in the worldwide top-1000 registry", repo, registry: registryMeta() },
        );
      },
    );

    server.registerTool(
      "get_velocity_rankings",
      {
        title: "Get velocity rankings",
        description: "The fastest-growing repositories right now, by stars/day, across the worldwide top 1000.",
        inputSchema: { limit: z.number().int().min(1).max(200).optional().describe("default 20") },
      },
      async ({ limit }) => json({ fastest: velocityRanking(limit ?? 20), registry: registryMeta() }),
    );

    server.registerTool(
      "get_active_overtakes",
      {
        title: "Get active overtakes",
        description:
          "Imminent rank overtakes: which repositories are about to pass which, with the star gap and ETA in days. The competitive pulse of the leaderboard.",
        inputSchema: { limit: z.number().int().min(1).max(200).optional().describe("default 20") },
      },
      async ({ limit }) => json({ overtakes: overtakes(limit ?? 20), registry: registryMeta() }),
    );

    server.registerTool(
      "compare_repos",
      {
        title: "Compare repositories",
        description: "Side-by-side worldwide rank and velocity for up to 10 repositories (canonical owner/name).",
        inputSchema: { repos: z.array(z.string()).min(1).max(10).describe("list of owner/name") },
      },
      async ({ repos }) => json({ results: compareRepos(repos), registry: registryMeta() }),
    );

    server.registerTool(
      "get_embed_snippet",
      {
        title: "Get README embed snippet",
        description:
          "An animated star-history chart embed for a repo's README: returns ready-to-paste markdown and HTML pointing at warpchart.dev.",
        inputSchema: { repo: z.string().describe("owner/name") },
      },
      async ({ repo }) => json(embedSnippet(repo)),
    );
  },
  {
    serverInfo: { name: "warpchart", version: "1.0.0" },
    instructions:
      "Warpchart: public growth telemetry over GitHub's worldwide top-1000 repositories (rank, star velocity, overtakes). All data is cache-only and refreshed daily. Use canonical owner/name.",
  },
  {
    basePath: "/api",
    maxDuration: 60,
  },
);

export { handler as GET, handler as POST, handler as DELETE };
