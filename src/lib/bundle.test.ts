import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ForensicsFile } from "@/lib/types";

// The house forensics file, exactly as the collector ships it (data-sample/ is
// the synthetic house repo a fork falls back to).
const houseForensics = JSON.parse(
  readFileSync(path.join(process.cwd(), "data-sample", "forensics.json"), "utf8"),
) as ForensicsFile;

// Every loader reads the HOUSE data/ directory. Pin them so the test does not
// depend on whatever data/ happens to be on disk.
vi.mock("@/lib/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/history")>()),
  loadTimestamps: () => [],
  loadHistory: () => [],
  loadMeta: () => null,
  loadMilestones: () => null,
  loadRoute: () => null,
  loadAttribution: () => null,
  loadForensics: () => houseForensics,
}));

const { buildBundle } = await import("@/lib/bundle");

describe("buildBundle spike forensics", () => {
  it("the house bundle carries the house spikes", () => {
    const b = buildBundle();
    expect(b.spikes).toHaveLength(houseForensics.spikes.length);
    expect(b.events.some((e) => e.kind === "spike")).toBe(true);
  });

  // Incident: a tenant console showed the house repo's HN spike in its Mission Log.
  it("a tenant bundle never borrows the house spikes", () => {
    const b = buildBundle({ timestamps: [], history: [], meta: null });
    expect(b.spikes).toEqual([]);
    expect(b.events.filter((e) => e.kind === "spike")).toEqual([]);
  });
});
