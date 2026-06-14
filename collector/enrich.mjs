#!/usr/bin/env node
// Offline semantic enrichment for the natural-language search (the recommend MCP
// tool / `warpchart find`). For each top repo it produces a clean one-line
// summary and 4-8 canonical capability tags ("agentic-memory", "vector-database"
// ...), so a search by NEED finds the right repo even when GitHub's own topics
// are missing or noisy (e.g. getzep/zep's description is just "Zep").
//
// It runs the LOCAL Claude CLI (Claude Code, `claude -p`), NOT the paid API, so
// the initial population is billed to the subscription. Batched (~25 repos per
// call) to amortise the per-call system-prompt cost, sequential, resumable
// (skips repos already enriched), and writes data/enrichment.json to the private
// Blob so the build's sync-from-blob hydrates it like the catalog.
//
// Usage: BLOB_READ_WRITE_TOKEN=... node collector/enrich.mjs [limit] [--model sonnet] [--batch 25]
import { spawnSync } from "node:child_process";
import { put, get } from "@vercel/blob";

const CATALOG_KEY = "data/catalog.json";
const ENRICH_KEY = "data/enrichment.json";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const LIMIT = Number(args.find((a) => /^\d+$/.test(a))) || 1000;
const MODEL = flag("--model", "sonnet");
const BATCH = Number(flag("--batch", "25"));

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error("[enrich] missing BLOB_READ_WRITE_TOKEN");
  process.exit(1);
}

async function readJson(key) {
  try {
    const res = await get(key, { access: "private", token });
    if (res?.statusCode === 200 && res.stream) return JSON.parse(await new Response(res.stream).text());
  } catch {
    /* missing */
  }
  return null;
}
async function writeJson(key, value) {
  await put(key, JSON.stringify(value), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
}

const catalog = await readJson(CATALOG_KEY);
if (!catalog?.repos?.length) {
  console.error("[enrich] no catalog in Blob; run collector/catalog.mjs first");
  process.exit(1);
}
const existing = (await readJson(ENRICH_KEY)) ?? { generated_at: null, model: MODEL, entries: {} };
existing.entries ??= {};

const todo = catalog.repos
  .slice(0, LIMIT)
  .filter((p) => !existing.entries[p.r.toLowerCase()]);
console.log(`[enrich] catalog ${catalog.repos.length} · target ${LIMIT} · already done ${LIMIT - todo.length} · to do ${todo.length} · model ${MODEL} · batch ${BATCH}`);

const PROMPT_HEAD =
  "You are tagging open-source GitHub repositories for a search engine that answers questions like \"what is the best agentic memory system?\".\n" +
  "For EACH repository below output an object with:\n" +
  '- "repo": the exact owner/name as given\n' +
  '- "summary": one concise sentence, max 90 chars, of what it primarily is and does\n' +
  '- "tags": 4 to 8 short lowercase capability tags (single words or hyphenated) for what the repo PRIMARILY IS and IS FOR, so a developer searching by need finds it. Prefer canonical terms (e.g. agentic-memory, vector-database, llm-framework, rag, web-framework, orm, observability, game-engine).\n' +
  "RULES: Tag only CENTRAL capabilities, the core of what the project is. Never add a tag for a feature merely mentioned in passing, implied, or present only as a sub-feature. If the description is vague or generic, give FEWER, conservative tags rather than guessing. Do NOT include the programming language or the org/author name as a tag.\n" +
  "Output ONLY a compact JSON array of these objects. No prose, no markdown fences.\n\nRepositories:\n";

function runClaude(promptText) {
  const res = spawnSync("claude", ["-p", "--model", MODEL, "--output-format", "json"], {
    input: promptText,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180000,
  });
  if (res.status !== 0 || !res.stdout) throw new Error(`claude exited ${res.status}: ${(res.stderr || "").slice(0, 200)}`);
  const outer = JSON.parse(res.stdout);
  let text = (outer.result ?? "").trim();
  // strip accidental ```json fences
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // tolerate leading prose: grab the first [ ... ] array
  const a = text.indexOf("[");
  const b = text.lastIndexOf("]");
  if (a >= 0 && b > a) text = text.slice(a, b + 1);
  return JSON.parse(text);
}

let done = 0;
let failed = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const lines = batch
    .map((p, k) => `${k + 1}. ${p.r} — ${(p.d ?? "no description").slice(0, 90)} — topics: ${(p.t ?? []).slice(0, 6).join(", ") || "none"}`)
    .join("\n");
  const label = `${i + 1}-${i + batch.length}/${todo.length}`;
  try {
    const arr = runClaude(PROMPT_HEAD + lines);
    const byKey = new Map(batch.map((p) => [p.r.toLowerCase(), p.r]));
    let got = 0;
    for (const o of Array.isArray(arr) ? arr : []) {
      const key = String(o.repo ?? "").toLowerCase();
      if (!byKey.has(key)) continue;
      const tags = Array.isArray(o.tags) ? o.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 8) : [];
      const summary = String(o.summary ?? "").trim().slice(0, 120);
      if (tags.length || summary) {
        existing.entries[key] = { tags, summary };
        got++;
      }
    }
    done += got;
    console.log(`[enrich] ${label} -> ${got}/${batch.length}`);
    // persist after every batch so a crash never loses progress
    existing.generated_at = new Date().toISOString();
    existing.model = MODEL;
    await writeJson(ENRICH_KEY, existing);
  } catch (err) {
    failed += batch.length;
    console.error(`[enrich] ${label} FAILED: ${err.message}`);
  }
}

console.log(`[enrich] complete: ${done} enriched this run, ${failed} failed, ${Object.keys(existing.entries).length} total in store`);
