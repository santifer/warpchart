// Warpchart MCP server — public, read-only growth telemetry for agents, over
// the SAME cache-only layer as /api/v1 (zero GitHub calls). Streamable HTTP at
// /api/mcp (the [transport] segment also serves /api/sse). Static /api/* routes
// take precedence over this dynamic segment, so it only catches mcp/sse.
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  repoStats,
  velocityRanking,
  leaderboard,
  overtakes,
  repoOvertakes,
  compareRepos,
  embedSnippet,
  registryMeta,
} from "@/lib/api-v1";
import { listCategories, risingInCategory, risingOverall, categoryById, catalogMeta } from "@/lib/catalog";
import { searchRepos } from "@/lib/search";

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
      "get_leaderboard",
      {
        title: "Get the leaderboard",
        description: "The biggest repositories by stars worldwide (top 1000), optionally filtered to one language.",
        inputSchema: {
          language: z.string().optional().describe("e.g. Rust, Python, TypeScript"),
          limit: z.number().int().min(1).max(200).optional().describe("default 20"),
        },
      },
      async ({ limit, language }) => json({ leaderboard: leaderboard(limit ?? 20, language), registry: registryMeta() }),
    );

    server.registerTool(
      "get_velocity_rankings",
      {
        title: "Get velocity rankings",
        description: "The fastest-growing repositories right now, by stars/day, optionally filtered to one language.",
        inputSchema: {
          language: z.string().optional().describe("e.g. Rust, Python, TypeScript"),
          limit: z.number().int().min(1).max(200).optional().describe("default 20"),
        },
      },
      async ({ limit, language }) => json({ fastest: velocityRanking(limit ?? 20, language), registry: registryMeta() }),
    );

    server.registerTool(
      "get_active_overtakes",
      {
        title: "Get active overtakes",
        description:
          "Imminent rank overtakes with star gap and ETA in days. Without arguments, the global pulse. With repo='owner/name', who is hunting THAT repo (about to pass it) and who it is about to pass.",
        inputSchema: {
          repo: z.string().optional().describe("owner/name — scope to one repo's hunters and targets"),
          limit: z.number().int().min(1).max(200).optional().describe("default 20 (global only)"),
        },
      },
      async ({ limit, repo }) =>
        repo
          ? json({ ...repoOvertakes(repo), registry: registryMeta() })
          : json({ overtakes: overtakes(limit ?? 20), registry: registryMeta() }),
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

    server.registerTool(
      "get_rising",
      {
        title: "Get rising repositories by category",
        description:
          "Discover what is climbing fastest on GitHub right now, ranked by momentum (stars/day), not just total stars. This is the present-tense signal a trained model cannot have: the live direction of what developers are choosing. Call with no arguments to list every category (AI, CLI, databases, frontend, security, by language, and more) ordered by heat. Pass category='ai-llm' (a category id from the list) to get the repos rising fastest in that domain, or language='Rust' to filter by language. Ideal for 'recommend a rising repo for X' questions.",
        inputSchema: {
          category: z.string().optional().describe("a category id from the no-arg listing, e.g. ai-llm, cli, databases, lang-rust"),
          language: z.string().optional().describe("filter the global rising list to one language, e.g. Rust, Go, Python"),
          limit: z.number().int().min(1).max(100).optional().describe("default 30"),
        },
      },
      async ({ category, language, limit }) => {
        const catalog = catalogMeta();
        if (category) {
          const cat = categoryById(category);
          const rising = risingInCategory(category, limit ?? 30);
          return json(
            cat && rising.length
              ? { category: { id: cat.id, label: cat.label, kind: cat.kind }, rising, catalog }
              : { error: "unknown or empty category", category, catalog },
          );
        }
        if (language) return json({ language, rising: risingOverall(limit ?? 30, language), catalog });
        return json({ categories: listCategories().categories, catalog });
      },
    );

    server.registerTool(
      "recommend",
      {
        title: "Recommend repositories for a need",
        description:
          "Answer 'what is the best <X>?' in natural language (e.g. 'the best agentic memory system', 'a fast vector database', 'a TUI framework in Rust'). Searches the worldwide catalog by intent (synonyms + capability tags) and ranks the matches by validation (stars) and momentum (stars/day), so the top result is the most-chosen AND climbing. This is the live, present-tense answer a trained model cannot give from its weights: it reflects what developers are choosing right now. Returns ranked repos with stars, velocity, worldwide rank and the console URL.",
        inputSchema: {
          query: z.string().describe("a natural-language need, e.g. 'best agentic memory system'"),
          limit: z.number().int().min(1).max(30).optional().describe("default 10"),
        },
      },
      async ({ query, limit }) => {
        const { results } = searchRepos(query, limit ?? 10);
        return json({ query, results, catalog: catalogMeta() });
      },
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
