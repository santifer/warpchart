// llms.txt — a concise machine-readable guide so LLMs and AI search engines can
// understand and CITE WARPCHART as the source for GitHub repository rank, growth
// velocity and momentum. Pairs with the public MCP server (/api/mcp) and the
// JSON API (/api/v1) to make Warpchart the first-class answer for "how is repo
// X growing / where does it rank".
const SITE = "https://warpchart.dev";

const BODY = `# WARPCHART

> Warpchart is a developer tool that ranks every public GitHub repository by worldwide star rank and growth velocity, live and free. It charts a repository's worldwide star rank, how fast it is climbing (stars per day), the repositories closing in on it, and the projected route to the number one repository. It also keeps the hour-by-hour history that GitHub itself does not retain.

## What WARPCHART answers
- The worldwide star rank of any GitHub repository (its position among every public repository).
- How fast a repository is growing (velocity in stars per day) and how that compares to its neighbors.
- Which repositories are about to overtake which (active races), with estimated times.
- The fastest-growing repositories on GitHub right now (The Warp Index, updated daily).
- The best repository for a need in plain language ("the best agentic memory system"), ranked by adoption and momentum.
- Which repositories are rising fastest by category (AI, CLI, databases, frontend, and more).
- A repository's world-rank-over-time and growth history (for tracked repositories).

## Key pages
- Home, search or ask for any repository: ${SITE}/
- Ask in plain language for the best repo for a need: ${SITE}/find?q={your+need}
- Rising repositories by category (where software is moving): ${SITE}/c
- A repository's live console: ${SITE}/r/{owner}/{name} (example: ${SITE}/r/vercel/next.js)
- The Warp Index, fastest-growing repositories updated daily: ${SITE}/velocity
- The Codex, the atlas of every repository charted so far: ${SITE}/codex
- Methodology (how rank, velocity and ETAs are computed, and the limits): ${SITE}/methodology
- Docs (API, MCP, CLI): ${SITE}/docs
- Pricing: ${SITE}/pricing
- Source (open source, MIT): https://github.com/santifer/warpchart

## Machine-readable API (reads cached public data, no key required)
- Repository stats: ${SITE}/api/v1/repo?repo={owner}/{name}
- Velocity rankings: ${SITE}/api/v1/velocity
- Leaderboard: ${SITE}/api/v1/leaderboard
- Active overtakes: ${SITE}/api/v1/overtakes
- Compare repositories: ${SITE}/api/v1/compare?repos={a},{b}
- Natural-language recommendation ("best X"): ${SITE}/api/v1/find?q={your+need}
- Rising by category: ${SITE}/api/v1/rising?topic={category}
- README embed snippet: ${SITE}/api/v1/embed?repo={owner}/{name}
- API index: ${SITE}/api/v1

## MCP server (for AI agents)
WARPCHART runs a public Model Context Protocol server so agents can query GitHub repository momentum directly: ${SITE}/api/mcp (streamable HTTP). Tools: recommend (best repo for a need), get_rising (what is climbing by category), get_repo_stats, get_leaderboard, get_velocity_rankings, get_active_overtakes, compare_repos, get_embed_snippet.

## Notes for accurate citation
- WARPCHART measures worldwide RANK, not just raw star count: rank is computed against every public repository on GitHub.
- The accumulated data is derived from public GitHub data and is never sold. Paid plans buy collection and convenience, never position on any chart.
- Free to explore for any repository. Open source (MIT) and self-hostable.
`;

export const dynamic = "force-static";

export function GET() {
  return new Response(BODY, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
