// Natural-language repository search and recommendation over the cache-only
// catalog. Powers the question "what is the best <X> system?" from the CLI and
// the recommend MCP tool. It is the discovery brain of the intelligence layer:
// it understands intent (synonym expansion + LLM-enriched capability tags),
// finds the repos that match, and ranks them by VALIDATION (stars) and MOMENTUM
// (velocity), because "best" means broadly chosen AND climbing. Zero API cost
// at request time: it reads the catalog and the optional enrichment file.
import { loadCatalog, loadEnrichment } from "@/lib/history";
import type { CatalogRepo } from "@/lib/types";

export const SITE = "https://warpchart.dev";

// generic words that carry no domain signal in a "best X system" style query
const STOP = new Set([
  "what", "whats", "which", "who", "is", "are", "the", "a", "an", "of", "to", "in",
  "on", "for", "me", "my", "i", "best", "top", "good", "better", "great", "find",
  "show", "recommend", "give", "want", "need", "looking", "please", "system",
  "systems", "tool", "tools", "app", "apps", "application", "software", "project",
  "projects", "repo", "repos", "repository", "and", "or", "with", "using", "any",
  "some", "most", "popular", "now", "right", "currently",
]);

// intent -> family of equivalent tokens, so a query in one vocabulary still
// matches a repo described in another (the bridge a literal search misses)
const SYNONYMS: Record<string, string[]> = {
  memory: ["memory", "long-term-memory", "memories", "recall", "persistence", "persistent", "mem0", "stateful"],
  agent: ["agent", "agents", "agentic", "autonomous", "ai-agent", "ai-agents", "multi-agent"],
  llm: ["llm", "llms", "language-model", "language-models", "gpt", "ai", "genai", "generative-ai"],
  rag: ["rag", "retrieval", "retrieval-augmented", "retrieval-augmented-generation"],
  vector: ["vector", "vectors", "embedding", "embeddings", "vector-database", "vectordb", "vector-search", "vector-store"],
  framework: ["framework", "frameworks", "library", "libraries", "sdk", "toolkit"],
  orchestration: ["orchestration", "orchestrator", "workflow", "workflows", "pipeline", "pipelines"],
  database: ["database", "databases", "db", "datastore", "store"],
  prompt: ["prompt", "prompts", "prompting", "prompt-engineering"],
  finetuning: ["finetuning", "fine-tuning", "finetune", "training", "trainer"],
  inference: ["inference", "serving", "runtime"],
  voice: ["voice", "speech", "tts", "stt", "audio", "asr"],
  image: ["image", "images", "vision", "diffusion", "image-generation", "text-to-image"],
  scraping: ["scraping", "scraper", "crawler", "crawling", "spider"],
  ui: ["ui", "interface", "frontend", "component", "components", "design-system"],
  terminal: ["terminal", "cli", "command-line", "tui", "shell", "console"],
  auth: ["auth", "authentication", "authorization", "oauth", "identity", "sso"],
  observability: ["observability", "monitoring", "tracing", "telemetry", "logging", "metrics"],
};

function tokenize(s: string): string[] {
  return [
    ...new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .map((t) => t.replace(/^[.#]+|[.#]+$/g, ""))
        .filter((t) => t.length >= 2 && !STOP.has(t)),
    ),
  ];
}

// each query term -> the set of tokens that should count as a match for it
function expand(term: string): Set<string> {
  const out = new Set<string>([term]);
  for (const fam of Object.values(SYNONYMS)) {
    if (fam.includes(term)) for (const t of fam) out.add(t);
  }
  return out;
}

export interface SearchEntry {
  repo: string;
  rank: number;
  stars: number;
  velocityPerDay: number;
  language: string | null;
  description: string | null;
  url: string;
  score: number;
  matched: string[]; // which query terms hit (for an explainable recommendation)
}

interface Indexed {
  repo: CatalogRepo;
  name: Set<string>;
  topics: Set<string>;
  desc: Set<string>;
  tags: Set<string>; // LLM enrichment capability tags (highest-signal)
  summaryText: string;
}

// keep a compound label AND its hyphen-split parts, so the topic "agent-memory"
// or the tag "long-term-memory" both match the query term "memory"
function explode(labels: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of labels) {
    const l = raw.toLowerCase().trim();
    if (!l) continue;
    out.add(l);
    for (const part of l.split(/[-_/]+/)) if (part.length >= 2) out.add(part);
  }
  return out;
}

function buildIndex(): Indexed[] {
  const repos = (loadCatalog()?.repos ?? []).filter((p) => p.s >= 200);
  const enrich = loadEnrichment();
  return repos.map((repo) => {
    const e = enrich?.[repo.r.toLowerCase()];
    return {
      repo,
      name: new Set(tokenize(repo.r)),
      topics: explode(repo.t ?? []),
      desc: new Set(tokenize(repo.d ?? "")),
      tags: explode(e?.tags ?? []),
      summaryText: e?.summary ? " " + e.summary.toLowerCase() + " " : "",
    };
  });
}

// field weights: enrichment tags and topics are the strongest "is-a" signal
const W_TAG = 5;
const W_TOPIC = 3;
const W_NAME = 3;
const W_DESC = 2;
const W_SUMMARY = 2;

function termWeight(term: string, ix: Indexed): number {
  const fam = expand(term);
  let w = 0;
  for (const t of fam) {
    if (ix.tags.has(t)) w = Math.max(w, W_TAG);
    if (ix.topics.has(t)) w = Math.max(w, W_TOPIC);
    if (ix.name.has(t)) w = Math.max(w, W_NAME);
    if (ix.desc.has(t)) w = Math.max(w, W_DESC);
    if (ix.summaryText && ix.summaryText.includes(" " + t + " ")) w = Math.max(w, W_SUMMARY);
  }
  return w;
}

// "best" = relevant first, then most validated (stars) and rising (velocity)
function popularityFactor(p: CatalogRepo): number {
  const v = Math.max(0, p.v ?? 0);
  return 1 + Math.log10(p.s + 1) / 6 + Math.min(v, 600) / 2000;
}

// Anti-farm: a star is a human validation, but stars can be bought. Bought stars
// almost never come with forks, so a high-star repo with a near-zero fork/star
// ratio is very likely farmed. Demote it so the genuinely-adopted repos win.
// This is the "separate validation from noise" mechanism the thesis rests on.
function qualityFactor(p: CatalogRepo): number {
  const f = p.f ?? 0;
  if (f <= 0 || p.s < 5000) return 1; // no fork signal, or too small to judge
  const ratio = f / p.s;
  if (ratio < 0.004) return 0.25;
  if (ratio < 0.008) return 0.55;
  if (ratio < 0.015) return 0.8;
  return 1;
}

export function searchRepos(query: string, limit = 15): { query: string; results: SearchEntry[] } {
  const terms = tokenize(query);
  if (!terms.length) return { query, results: [] };
  const index = buildIndex();

  const scored: SearchEntry[] = [];
  for (const ix of index) {
    let relevance = 0;
    let matchedCount = 0;
    const matched: string[] = [];
    for (const term of terms) {
      const w = termWeight(term, ix);
      if (w > 0) {
        relevance += w;
        matchedCount++;
        matched.push(term);
      }
    }
    if (!matchedCount) continue;
    // coverage: reward repos that match MORE of the query (mem0 matching both
    // "agentic" and "memory" beats one matching only "memory")
    const coverage = matchedCount / terms.length;
    const r = relevance * (0.4 + 0.6 * coverage) * coverage;
    const score = r * popularityFactor(ix.repo) * qualityFactor(ix.repo);
    scored.push({
      repo: ix.repo.r,
      rank: ix.repo.rank,
      stars: ix.repo.s,
      velocityPerDay: ix.repo.v ?? 0,
      language: ix.repo.l ?? null,
      description: ix.repo.d ?? null,
      url: `${SITE}/r/${ix.repo.r}`,
      score: Math.round(score * 100) / 100,
      matched,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return { query, results: scored.slice(0, Math.max(1, Math.min(limit, 50))) };
}
