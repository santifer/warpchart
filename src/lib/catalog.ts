// The rising-by-category directory's intelligence layer (powers /c, the
// /api/v1/rising feed, the get_rising MCP tool and the CLI). It reads the
// cache-only catalog (data/catalog.json, written daily by the collector's deep
// sweep) and turns it into "what is climbing fastest, by purpose".
//
// The thesis in code: we do NOT rank by raw stars (saturated, gameable). We
// rank by MOMENTUM with a noise floor, because a star is a human validating a
// project and the live derivative of that validation is the one signal a
// trained model cannot have. GitHub Trending shows the what; this shows the
// what plus the where-it-is-going, by category.
import { loadCatalog } from "@/lib/history";
import type { CatalogRepo } from "@/lib/types";
import { canonicalVel0 } from "@/lib/velocity";

export const SITE = "https://warpchart.dev";

// Only repos at or above this many stars enter the directory: keeps the signal
// to genuine, broadly-validated projects (filters one-day flukes and noise).
const MIN_STARS = 300;

export type CategoryKind = "topic" | "lang";

export interface Category {
  id: string;
  label: string;
  kind: CategoryKind;
  blurb?: string;
}

// Curated topic taxonomy. Membership is by GitHub topics (the natural "for X"
// axis), with a few language hints. Repos can belong to several. This is
// deliberately a finite, hand-picked set: it sidesteps the two failure modes of
// auto-generated awesome lists (repos with zero topics, and a long tail of junk
// topics). Languages are a separate, always-populated axis below.
interface TopicCat extends Category {
  topics: string[];
}

const TOPIC_CATS: TopicCat[] = [
  { id: "ai-llm", label: "AI & LLMs", kind: "topic", blurb: "Large language models, agents, RAG and the tools around them.", topics: ["llm", "llms", "large-language-models", "genai", "generative-ai", "gpt", "chatgpt", "openai", "agents", "ai-agents", "rag", "prompt-engineering", "llmops", "ai"] },
  { id: "machine-learning", label: "Machine Learning", kind: "topic", blurb: "Training, inference and the classic ML and data-science stack.", topics: ["machine-learning", "deep-learning", "neural-network", "neural-networks", "pytorch", "tensorflow", "data-science", "computer-vision", "nlp", "reinforcement-learning"] },
  { id: "cli", label: "Command Line", kind: "topic", blurb: "Terminal tools, TUIs and everything you run from a shell.", topics: ["cli", "command-line", "command-line-tool", "terminal", "tui", "shell", "console"] },
  { id: "web-frameworks", label: "Web Frameworks", kind: "topic", blurb: "The frameworks people build the web on.", topics: ["framework", "web-framework", "frontend-framework", "fullstack", "ssr"] },
  { id: "frontend", label: "Frontend & UI", kind: "topic", blurb: "Components, design systems and everything that ships to the browser.", topics: ["frontend", "react", "vue", "svelte", "ui", "css", "tailwindcss", "components", "design-system", "ui-components", "web-components"] },
  { id: "backend", label: "Backend & APIs", kind: "topic", blurb: "Servers, APIs and the machinery behind the request.", topics: ["backend", "api", "rest", "rest-api", "graphql", "microservices", "server", "grpc"] },
  { id: "databases", label: "Databases", kind: "topic", blurb: "Stores, engines and the layers that talk to them.", topics: ["database", "sql", "nosql", "postgres", "postgresql", "mysql", "sqlite", "vector-database", "orm", "redis", "key-value"] },
  { id: "devops", label: "DevOps & Infra", kind: "topic", blurb: "Containers, orchestration, IaC and observability.", topics: ["devops", "kubernetes", "k8s", "docker", "ci-cd", "infrastructure", "terraform", "observability", "monitoring", "cloud-native"] },
  { id: "devtools", label: "Developer Tools", kind: "topic", blurb: "Build tools, bundlers, package managers and productivity boosters.", topics: ["developer-tools", "dev-tools", "build-tool", "bundler", "package-manager", "productivity", "code-quality", "linter"] },
  { id: "security", label: "Security", kind: "topic", blurb: "Offensive, defensive and the cryptography in between.", topics: ["security", "cybersecurity", "infosec", "pentesting", "cryptography", "authentication", "hacking", "appsec"] },
  { id: "data-engineering", label: "Data Engineering", kind: "topic", blurb: "Pipelines, ETL, streaming and analytics at scale.", topics: ["data-engineering", "etl", "data-pipeline", "analytics", "big-data", "streaming", "data-lake", "spark"] },
  { id: "mobile", label: "Mobile", kind: "topic", blurb: "iOS, Android and cross-platform apps.", topics: ["android", "ios", "mobile", "flutter", "react-native", "mobile-development"] },
  { id: "game-dev", label: "Game Dev", kind: "topic", blurb: "Engines, frameworks and tools for making games.", topics: ["game", "gamedev", "game-development", "game-engine", "godot", "unity", "graphics"] },
  { id: "editors", label: "Editors & IDEs", kind: "topic", blurb: "Where code gets written, and the plugins that shape it.", topics: ["editor", "ide", "vim", "neovim", "vscode", "text-editor", "code-editor"] },
  { id: "self-hosted", label: "Self-Hosted", kind: "topic", blurb: "Run it yourself: homelab, home automation and self-hosting.", topics: ["self-hosted", "selfhosted", "homelab", "home-automation", "homeassistant"] },
  { id: "automation", label: "Automation & Bots", kind: "topic", blurb: "Workflows, no-code, bots and the glue between systems.", topics: ["automation", "workflow", "no-code", "low-code", "rpa", "bot", "bots", "scraping", "scraper"] },
  { id: "blockchain", label: "Blockchain & Web3", kind: "topic", blurb: "Chains, contracts and the decentralized stack.", topics: ["blockchain", "web3", "ethereum", "crypto", "cryptocurrency", "solidity", "smart-contracts", "bitcoin"] },
  { id: "learning", label: "Learning & Awesome", kind: "topic", blurb: "Curated lists, tutorials, roadmaps and free education.", topics: ["awesome", "awesome-list", "tutorial", "learning", "education", "roadmap", "interview", "books", "course", "free", "resources", "cheatsheet"] },
  { id: "systems", label: "Systems & Languages", kind: "topic", blurb: "Kernels, compilers, runtimes and systems programming.", topics: ["operating-system", "kernel", "embedded", "systems-programming", "compiler", "wasm", "webassembly", "programming-language", "interpreter"] },
  { id: "data-viz", label: "Data Viz", kind: "topic", blurb: "Charts, dashboards and making data legible.", topics: ["visualization", "data-visualization", "charts", "dashboard", "plotting", "graph"] },
  { id: "design", label: "Design & Media", kind: "topic", blurb: "Design tools, icons, fonts, audio, video and images.", topics: ["design", "ui-ux", "figma", "icons", "fonts", "animation", "video", "audio", "image", "ffmpeg", "music", "3d"] },
  { id: "productivity-apps", label: "Productivity Apps", kind: "topic", blurb: "Notes, knowledge management and getting things done.", topics: ["notes", "note-taking", "knowledge-management", "todo", "markdown", "pkm", "second-brain"] },
];

// languages worth featuring as their own (always-populated) categories
const FEATURED_LANGS = new Set([
  "rust", "go", "typescript", "javascript", "python", "c", "c++", "c#", "java",
  "kotlin", "swift", "ruby", "php", "zig", "elixir", "lua", "shell", "html",
]);

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function langSlug(lang: string): string {
  return "lang-" + norm(lang).replace(/\+/g, "p").replace(/#/g, "sharp").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

interface Loaded {
  repos: CatalogRepo[];
  byCat: Map<string, CatalogRepo[]>;
  cats: Map<string, Category>;
  asOf: string | null;
}

// Build the category index once. Server-only; pages are ISR so this runs at
// most once per revalidation window.
function load(): Loaded {
  const file = loadCatalog();
  const all = (file?.repos ?? []).filter((p) => p.s >= MIN_STARS);
  const byCat = new Map<string, CatalogRepo[]>();
  const cats = new Map<string, Category>();
  const push = (cat: Category, repo: CatalogRepo) => {
    if (!cats.has(cat.id)) cats.set(cat.id, { id: cat.id, label: cat.label, kind: cat.kind, blurb: cat.blurb });
    (byCat.get(cat.id) ?? byCat.set(cat.id, []).get(cat.id)!).push(repo);
  };

  for (const repo of all) {
    const topics = (repo.t ?? []).map(norm);
    const tset = new Set(topics);
    for (const c of TOPIC_CATS) {
      if (c.topics.some((t) => tset.has(t))) push(c, repo);
    }
    const lang = repo.l ? norm(repo.l) : null;
    if (lang && FEATURED_LANGS.has(lang)) {
      push({ id: langSlug(repo.l!), label: repo.l!, kind: "lang" }, repo);
    }
  }
  return { repos: all, byCat, cats, asOf: file?.generated_at ?? null };
}

// stars/day, never negative for ranking purposes. The CANONICAL velocity lives
// in one place (velocity.ts): the stable 7-day rate, ~1-day fallback, so /c
// ranks and displays match /velocity, /r/, the API and the badges instead of the
// trailing-1-day diff (the contradiction the methodology page forbids).
const vel = (p: CatalogRepo) => canonicalVel0(p);

// RELATIVE daily growth = stars/day as a fraction of the repo's own size. This
// is what "trending" actually means: a 3k-star repo gaining 6%/day is hotter
// than a 200k-star repo gaining 0.3%/day, even though the giant's ABSOLUTE
// stars/day is larger. Ranking by absolute velocity just resurfaces the giants
// (saturation by size); ranking by relative growth surfaces real breakouts.
// Floors kill noise (a 100->150 repo is not "trending"): a real base AND real
// daily movement are both required before the ratio counts.
const REL_S_FLOOR = 1000;
const REL_V_FLOOR = 25; // mirrors the Warp Index velocity board's relative floor
const relGrowth = (p: CatalogRepo) => (p.s >= REL_S_FLOOR && vel(p) >= REL_V_FLOOR ? vel(p) / p.s : 0);

// Rank a member set by RELATIVE momentum (true trending). Falls back to absolute
// velocity, then raw stars, when too few repos clear the floor (a niche category
// or the very first days), so a page is never empty.
function rankRising(members: CatalogRepo[], limit: number): CatalogRepo[] {
  const cap = Math.max(1, Math.min(limit, 100));
  const trending = members.filter((p) => relGrowth(p) > 0);
  if (trending.length >= 5) {
    return trending.sort((a, b) => relGrowth(b) - relGrowth(a)).slice(0, cap);
  }
  const moving = members.filter((p) => vel(p) > 0);
  const base = moving.length >= 5 ? moving : [...members];
  return base.sort((a, b) => (moving.length >= 5 ? vel(b) - vel(a) : b.s - a.s)).slice(0, cap);
}

export interface CategorySummary extends Category {
  count: number;
  heat: number; // total stars/day the whole category is gaining = its momentum
  top: { repo: string; stars: number; velocityPerDay: number }[];
}

// All categories, sorted by heat (the "where software is moving" ordering).
export function listCategories(): { asOf: string | null; categories: CategorySummary[] } {
  const { byCat, cats, asOf } = load();
  const out: CategorySummary[] = [];
  for (const [id, members] of byCat) {
    const cat = cats.get(id)!;
    const heat = Math.round(members.reduce((s, p) => s + vel(p), 0));
    const top = rankRising(members, 3).map((p) => ({ repo: p.r, stars: p.s, velocityPerDay: Math.round(vel(p)) }));
    out.push({ ...cat, count: members.length, heat, top });
  }
  out.sort((a, b) => b.heat - a.heat || b.count - a.count);
  return { asOf, categories: out };
}

export interface RisingEntry {
  repo: string;
  rank: number; // worldwide rank
  stars: number;
  velocityPerDay: number;
  growthPctDay: number; // daily growth as % of own size — the "trending" signal
  language: string | null;
  description: string | null;
  forks: number | null;
  url: string;
}

const toEntry = (p: CatalogRepo): RisingEntry => ({
  repo: p.r,
  rank: p.rank,
  stars: p.s,
  velocityPerDay: Math.round(vel(p)),
  growthPctDay: p.s > 0 ? Math.round((vel(p) / p.s) * 1000) / 10 : 0,
  language: p.l ?? null,
  description: p.d ?? null,
  forks: p.f ?? null,
  url: `${SITE}/r/${p.r}`,
});

export function categoryById(id: string): Category | null {
  const { cats } = load();
  return cats.get(id) ?? null;
}

// Catalog freshness (for page footers / API meta), independent of any category.
export function catalogMeta(): { size: number; asOf: string | null } {
  const { repos, asOf } = load();
  return { size: repos.length, asOf };
}

// The rising repos in one category, by momentum. Empty array for unknown ids.
export function risingInCategory(id: string, limit = 30): RisingEntry[] {
  const { byCat } = load();
  const members = byCat.get(id);
  if (!members?.length) return [];
  return rankRising(members, limit).map(toEntry);
}

// Global rising across the whole catalog, optionally filtered to one language.
export function risingOverall(limit = 30, language?: string): RisingEntry[] {
  const { repos } = load();
  const lang = language ? norm(language) : null;
  const members = lang ? repos.filter((p) => norm(p.l ?? "") === lang) : repos;
  return rankRising(members, limit).map(toEntry);
}
