// Build-time / server-side loaders for the data/ directory.
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { allNamesOf, canonicalRepo } from "./aliases";
import type { Snapshot, RepoMetaFile, MilestonesFile, RouteFile, ForensicsFile, AttributionFile, CollisionsFile, CatalogFile, EnrichmentEntry, EnrichmentFile } from "./types";

const DATA = path.join(process.cwd(), "data");

// data/ is written once per deploy (scripts/sync-from-blob.mjs at prebuild) and
// only read at runtime, yet every loader re-read and re-parsed its file on every
// call: one /r/ render parsed route.json four times. Each file is parsed once
// per instance, keyed by its path and checked against mtime + size, so `next
// dev` still sees a collector run that rewrites data/ underneath it.
//
// The parsed value is SHARED by every caller from then on, so it is frozen: a
// caller that sorts or patches it in place would silently change the number
// every later request reads. Frozen, that caller throws instead.
const memo = new Map<string, { mtimeMs: number; size: number; value: unknown }>();

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

// A missing file is `missing`, never memoized (it can appear later in dev). A
// parse that throws is not memoized either: the next call retries and throws
// again, exactly as before.
function readParsed<T>(p: string, parse: (raw: string) => T, missing: T): T {
  const st = statSync(p, { throwIfNoEntry: false });
  if (!st) {
    memo.delete(p);
    return missing;
  }
  const hit = memo.get(p);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value as T;
  const value = deepFreeze(parse(readFileSync(p, "utf8")));
  memo.set(p, { mtimeMs: st.mtimeMs, size: st.size, value });
  return value;
}

const parseLines = (raw: string): string[] => raw.trimEnd().split("\n").filter(Boolean);

function parseJsonl(raw: string): Snapshot[] {
  const out: Snapshot[] = [];
  for (const line of raw.trimEnd().split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Snapshot);
    } catch {
      // tolerate a torn line (concurrent write), skip it
    }
  }
  return out;
}

const parseJson = <T>(raw: string): T => JSON.parse(raw) as T;

// For the loaders that already swallowed a corrupt file into null.
const parseJsonOrNull =
  <T>() =>
  (raw: string): T | null => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

export function loadTimestamps(): string[] {
  return readParsed(path.join(DATA, "stargazer_timestamps.txt"), parseLines, []);
}

export function lastTimestamp(): string | null {
  const ts = loadTimestamps();
  return ts.length ? ts[ts.length - 1] : null;
}

export function loadHistory(): Snapshot[] {
  return readParsed(path.join(DATA, "history.jsonl"), parseJsonl, []);
}

export function lastSnapshot(): Snapshot | null {
  const h = loadHistory();
  return h.length ? h[h.length - 1] : null;
}

// Most recent snapshot whose neighbor list survived. A GitHub outage during
// one collector run writes neighbors:null, and serving that as an empty band
// silently freezes the chart on day-old bundle data (seen 11-jun: agent-skills
// shown behind after it had already overtaken).
export function lastNeighborsSnapshot(): Snapshot | null {
  const h = loadHistory();
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].neighbors?.length) return h[i];
  }
  return null;
}

export function loadMeta(): RepoMetaFile | null {
  return readParsed(path.join(DATA, "meta.json"), parseJson<RepoMetaFile>, null);
}

// True when the app is running on the bundled synthetic sample — i.e. a fork
// with no private data store fell back to data-sample/. The accumulated real
// history is the moat and never ships in git; a fork gets the "toy" instead.
// Drives the DEMO banner (a billboard back to the hosted product). On the real
// site (a real repo in data/) this is always false.
export function isSampleMode(): boolean {
  return loadMeta()?.repo?.toLowerCase() === "warpchart/sample";
}

// Paying missions beyond the house repo. The collector walks each one's
// exact history into data/tenants/{owner}--{name}/ on every run.
export interface TenantEntry {
  repo: string;
  plan: "hosted" | "fleet";
  since: string;
  // per-tenant secret that unlocks the PRIVATE traffic vault view (issued on
  // provisioning, sent in the welcome email). Traffic is owner-only data, never
  // shown on the public console.
  vaultKey?: string;
  // buyer email (from the Polar order), so the alerts cron can push milestone /
  // overtake / record events. PRIVATE (registry lives in the private Blob); never
  // exposed on any public surface.
  email?: string;
}

export function loadTenants(): TenantEntry[] {
  return readParsed(path.join(DATA, "tenants.json"), (raw) => parseJsonOrNull<TenantEntry[]>()(raw) ?? [], []);
}

// Rename-tolerant: a tenant registered under its old name must keep matching
// queries for the new one (and vice versa), or a paying repo's console dies
// silently the day its owner renames/transfers it.
export function isHostedRepo(repo: string): boolean {
  return findTenant(repo) !== undefined;
}

// Alias-aware tenant lookup: matches whichever name (old or new) the caller
// or the registry happens to hold. Single source for every vault-key gate.
export function findTenant(repo: string): TenantEntry | undefined {
  const lower = canonicalRepo(repo).toLowerCase();
  return loadTenants().find((t) => canonicalRepo(t.repo).toLowerCase() === lower);
}

function tenantDir(repo: string): string {
  // The collector keys the data dir by the name it resolves at collect time,
  // so after a rename the OLD dir holds the history until the next full run.
  // Prefer the canonical dir, fall back through every historical name.
  for (const name of [...allNamesOf(repo)].reverse()) {
    const p = path.join(DATA, "tenants", name.toLowerCase().replace("/", "--"));
    if (existsSync(p)) return p;
  }
  return path.join(DATA, "tenants", canonicalRepo(repo).toLowerCase().replace("/", "--"));
}

export function loadTenantTimestamps(repo: string): string[] {
  return readParsed(path.join(tenantDir(repo), "stargazer_timestamps.txt"), parseLines, []);
}

export function loadTenantHistory(repo: string): Snapshot[] {
  return readParsed(path.join(tenantDir(repo), "history.jsonl"), parseJsonl, []);
}

export function loadMilestones(): MilestonesFile | null {
  return readParsed(path.join(DATA, "milestones.json"), parseJson<MilestonesFile>, null);
}

export function loadRoute(): RouteFile | null {
  return readParsed(path.join(DATA, "route.json"), parseJson<RouteFile>, null);
}

export function loadCatalog(): CatalogFile | null {
  return readParsed(path.join(DATA, "catalog.json"), parseJsonOrNull<CatalogFile>(), null);
}

export function loadEnrichment(): Record<string, EnrichmentEntry> | null {
  return readParsed(
    path.join(DATA, "enrichment.json"),
    (raw) => parseJsonOrNull<EnrichmentFile>()(raw)?.entries ?? null,
    null,
  );
}

export function loadForensics(): ForensicsFile | null {
  return readParsed(path.join(DATA, "forensics.json"), parseJson<ForensicsFile>, null);
}

// Hourly star surges attributed to their traffic source (collector/attribute.mjs).
// House repo only; never present on tenant data.
export function loadAttribution(): AttributionFile | null {
  return readParsed(path.join(DATA, "attribution.json"), parseJsonOrNull<AttributionFile>(), null);
}

export function loadCollisions(): CollisionsFile | null {
  return readParsed(path.join(DATA, "collisions.json"), parseJson<CollisionsFile>, null);
}
