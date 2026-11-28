// The public surface (REST API, MCP server, CLI), listed ONCE. The /api/v1
// index, /docs and llms.txt render from here; the README links to /docs instead
// of keeping its own copy. These lists used to be hand-copied across seven
// places and disagreed (the README's MCP list was two tools short, /docs
// claimed --json on every CLI command).
//
// surface.test.ts holds this file to the code: every directory under
// src/app/api/v1, every tool registered in src/app/api/[transport]/route.ts and
// every command in the CLI's help. Add a route, a tool or a command and the
// test names the list to update.

export interface Endpoint {
  sig: string; // "GET /api/v1/<name>?example=params"
  desc: string;
}

export const API_ENDPOINTS: Endpoint[] = [
  {
    sig: "GET /api/v1/repo?repo=owner/name",
    desc: "Worldwide rank, stars, velocity, ranking neighbours and the next milestone gate for a repo in the top-1000 registry.",
  },
  {
    sig: "GET /api/v1/dossier?repo=owner/name&range=30d",
    desc: "The whole record the console shows, in one call: registry, engineering health, contributors, npm installs and clone traffic. Locked sections say so. Daily series accept since, until or range.",
  },
  {
    sig: "GET /api/v1/leaderboard?limit=20&language=Rust",
    desc: "The biggest repositories by stars, optionally filtered to one language.",
  },
  {
    sig: "GET /api/v1/velocity?limit=20&language=Rust",
    desc: "The fastest-growing repositories right now (stars/day), optionally by language. Add &format=csv.",
  },
  {
    sig: "GET /api/v1/rising?topic=ai-llm",
    desc: "Rising by category. Without a topic, every domain ordered by momentum; with ?topic= or ?language=, the repos climbing fastest in it.",
  },
  {
    sig: "GET /api/v1/find?q=agentic+memory+system",
    desc: "Natural-language recommendation: the catalog repos that match a need, ranked by adoption (stars) and momentum (velocity).",
  },
  {
    sig: "GET /api/v1/overtakes?limit=20",
    desc: "Imminent rank overtakes globally. Add ?repo=owner/name for who is hunting that repo and who it is about to pass.",
  },
  {
    sig: "GET /api/v1/compare?repos=a/b,c/d",
    desc: "Side-by-side stats for up to 10 repos.",
  },
  {
    sig: "GET /api/v1/embed?repo=owner/name",
    desc: "An animated star-history chart embed snippet (markdown + HTML) for a README.",
  },
  {
    sig: "GET /api/v1/badges",
    desc: "The primary classification of every badged repo in the registry, keyed by lower-cased owner/name.",
  },
];

// Routes under /api/v1 that are deliberately NOT public: key-gated, so never
// listed. The test treats them as accounted for.
export const API_PRIVATE = ["rank-history", "velocity-rank"];

export interface Tool {
  name: string;
  desc: string;
}

export const MCP_TOOLS: Tool[] = [
  { name: "recommend", desc: "Ask 'what is the best <X>?' Returns the matching repos ranked by adoption and momentum." },
  { name: "get_rising", desc: "What is climbing fastest, by category or language (no argument lists the categories)." },
  { name: "get_repo_stats", desc: "Worldwide rank, stars, velocity, neighbours and the next milestone gate." },
  { name: "get_velocity_rankings", desc: "The fastest-growing repos right now, optionally by language." },
  { name: "get_leaderboard", desc: "The biggest repos by stars, optionally by language." },
  { name: "get_active_overtakes", desc: "Imminent rank overtakes with star gap and ETA. Pass repo for who is hunting it." },
  { name: "compare_repos", desc: "Side-by-side rank and velocity for up to 10 repos." },
  { name: "get_embed_snippet", desc: "A README chart embed snippet for a repo." },
];

export interface Command {
  sig: string; // "warpchart <command> <args>"
  desc: string;
  json: boolean; // honours --json
}

export const CLI_COMMANDS: Command[] = [
  { sig: "warpchart <owner/name>", desc: "Worldwide rank, stars/day, a braille star chart and who is hunting it.", json: true },
  { sig: "warpchart dossier <owner/name>", desc: "The whole record: engineering health, people, usage and traffic.", json: true },
  { sig: "warpchart contributors <owner/name>", desc: "The contributor census and its curve.", json: true },
  { sig: "warpchart usage <owner/name>", desc: "npm installs and git clones over time.", json: true },
  { sig: "warpchart find <question>", desc: "Best repos for a need, ranked by adoption and momentum.", json: true },
  { sig: "warpchart rising [category]", desc: "What is climbing fastest, by domain (no argument lists the categories).", json: false },
  { sig: "warpchart hunters <owner/name>", desc: "Who is about to overtake it, and who it is about to pass.", json: false },
  { sig: "warpchart top [N] --lang X", desc: "The biggest repos by stars, optionally by language.", json: false },
  { sig: "warpchart velocity [N] --lang X", desc: "The fastest-growing repos right now, optionally by language.", json: false },
  { sig: "warpchart compare a/b c/d", desc: "Side by side.", json: false },
  { sig: "warpchart embed <owner/name>", desc: "A ready-to-paste README chart embed snippet.", json: false },
];

// "/api/v1/repo" from "GET /api/v1/repo?repo=owner/name"
export const endpointPath = (e: Endpoint) => e.sig.replace(/^GET\s+/, "").split("?")[0];
// "dossier" from "warpchart dossier <owner/name>"; "<owner/name>" for the bare form
export const commandName = (c: Command) => c.sig.split(/\s+/)[1];
