// Natural-language repository search and recommendation over the cache-only
// catalog. Powers the question "what is the best <X> system?" from the CLI and
// the recommend MCP tool. It is the discovery brain of the intelligence layer:
// it understands intent (synonym expansion + LLM-enriched capability tags),
// finds the repos that match, and ranks them by VALIDATION (stars) and MOMENTUM
// (velocity), because "best" means broadly chosen AND climbing. Zero API cost
// at request time: it reads the catalog and the optional enrichment file.
import { loadCatalog, loadEnrichment } from "@/lib/history";
import type { CatalogRepo } from "@/lib/types";
import { canonicalVel0 } from "@/lib/velocity";

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
  tags: string[]; // LLM enrichment capability tags, ORDERED by centrality
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
      tags: (e?.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean),
      summaryText: e?.summary ? " " + e.summary.toLowerCase() + " " : "",
    };
  });
}

// field weights: enrichment tags and topics are the strongest "is-a" signal.
// A tag that is the repo's PRIMARY identity (first in the ordered list) counts
// for more than one buried deep, so a true "agentic memory" project outranks a
// generalist that merely lists memory as a secondary feature.
const W_TAG_TOP = 5; // weight of a matched first/primary tag
const W_TAG_MIN = 3; // floor for a matched later tag
const W_TOPIC = 3;
const W_NAME = 3;
const W_DESC = 2;
const W_SUMMARY = 2;

function tagWeight(fam: Set<string>, tags: string[]): number {
  let best = 0;
  for (let i = 0; i < tags.length; i++) {
    const parts = explode([tags[i]]);
    let hit = false;
    for (const t of fam) if (parts.has(t)) { hit = true; break; }
    if (hit) best = Math.max(best, Math.max(W_TAG_TOP - i * 0.7, W_TAG_MIN));
  }
  return best;
}

function termWeight(term: string, ix: Indexed): number {
  const fam = expand(term);
  let w = tagWeight(fam, ix.tags);
  for (const t of fam) {
    if (ix.topics.has(t)) w = Math.max(w, W_TOPIC);
    if (ix.name.has(t)) w = Math.max(w, W_NAME);
    if (ix.desc.has(t)) w = Math.max(w, W_DESC);
    if (ix.summaryText && ix.summaryText.includes(" " + t + " ")) w = Math.max(w, W_SUMMARY);
  }
  return w;
}

// "best" = relevant first, then most validated (stars) and rising (velocity).
// We treat every repository as legitimate: warpchart reports what the data
// says (stars and momentum), it does not judge a repo as "fake" or downrank it.
function popularityFactor(p: CatalogRepo): number {
  const v = canonicalVel0(p); // canonical 7-day rate (velocity.ts)
  return 1 + Math.log10(p.s + 1) / 8 + Math.min(v, 600) / 2000;
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
    const score = r * popularityFactor(ix.repo);
    scored.push({
      repo: ix.repo.r,
      rank: ix.repo.rank,
      stars: ix.repo.s,
      velocityPerDay: Math.round(canonicalVel0(ix.repo)),
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
