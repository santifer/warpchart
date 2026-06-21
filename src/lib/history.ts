// Build-time / server-side loaders for the data/ directory.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Snapshot, RepoMetaFile, MilestonesFile, RouteFile, ForensicsFile, AttributionFile, CollisionsFile, CatalogFile, EnrichmentEntry, EnrichmentFile } from "./types";

const DATA = path.join(process.cwd(), "data");

export function loadTimestamps(): string[] {
  const p = path.join(DATA, "stargazer_timestamps.txt");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").trimEnd().split("\n").filter(Boolean);
}

export function lastTimestamp(): string | null {
  const ts = loadTimestamps();
  return ts.length ? ts[ts.length - 1] : null;
}

export function loadHistory(): Snapshot[] {
  const p = path.join(DATA, "history.jsonl");
  if (!existsSync(p)) return [];
  const out: Snapshot[] = [];
  for (const line of readFileSync(p, "utf8").trimEnd().split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Snapshot);
    } catch {
      // tolerate a torn line (concurrent write), skip it
    }
  }
  return out;
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
  const p = path.join(DATA, "meta.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as RepoMetaFile;
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
  const p = path.join(DATA, "tenants.json");
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")) as TenantEntry[];
  } catch {
    return [];
  }
}

export function isHostedRepo(repo: string): boolean {
  const lower = repo.toLowerCase();
  return loadTenants().some((t) => t.repo.toLowerCase() === lower);
}

function tenantDir(repo: string): string {
  return path.join(DATA, "tenants", repo.toLowerCase().replace("/", "--"));
}

export function loadTenantTimestamps(repo: string): string[] {
  const p = path.join(tenantDir(repo), "stargazer_timestamps.txt");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").trimEnd().split("\n").filter(Boolean);
}

export function loadTenantHistory(repo: string): Snapshot[] {
  const p = path.join(tenantDir(repo), "history.jsonl");
  if (!existsSync(p)) return [];
  const out: Snapshot[] = [];
  for (const line of readFileSync(p, "utf8").trimEnd().split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Snapshot);
    } catch {
      /* skip torn line */
    }
  }
  return out;
}

export function loadMilestones(): MilestonesFile | null {
  const p = path.join(DATA, "milestones.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as MilestonesFile;
}

export function loadRoute(): RouteFile | null {
  const p = path.join(DATA, "route.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as RouteFile;
}

export function loadCatalog(): CatalogFile | null {
  const p = path.join(DATA, "catalog.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as CatalogFile;
  } catch {
    return null;
  }
}

export function loadEnrichment(): Record<string, EnrichmentEntry> | null {
  const p = path.join(DATA, "enrichment.json");
  if (!existsSync(p)) return null;
  try {
    return (JSON.parse(readFileSync(p, "utf8")) as EnrichmentFile).entries ?? null;
  } catch {
    return null;
  }
}

export function loadForensics(): ForensicsFile | null {
  const p = path.join(DATA, "forensics.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as ForensicsFile;
}

// Hourly star surges attributed to their traffic source (collector/attribute.mjs).
// House repo only; never present on tenant data.
export function loadAttribution(): AttributionFile | null {
  const p = path.join(DATA, "attribution.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as AttributionFile;
  } catch {
    return null;
  }
}

export function loadCollisions(): CollisionsFile | null {
  const p = path.join(DATA, "collisions.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as CollisionsFile;
}
