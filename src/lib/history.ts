// Build-time / server-side loaders for the data/ directory.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Snapshot, RepoMetaFile, MilestonesFile, RouteFile, ForensicsFile } from "./types";

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

export function loadMeta(): RepoMetaFile | null {
  const p = path.join(DATA, "meta.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as RepoMetaFile;
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

export function loadForensics(): ForensicsFile | null {
  const p = path.join(DATA, "forensics.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as ForensicsFile;
}
