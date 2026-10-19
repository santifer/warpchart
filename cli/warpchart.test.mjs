import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The CLI against a local stand-in for the public API, answering a dossier the
// way /api/v1/dossier does when a measurement failed: the field is null. The
// terminal used to print those as numbers ("0", "#0", "null maintainers").
const CLI = fileURLToPath(new URL("./warpchart.mjs", import.meta.url));
const run = promisify(execFile);

const DOSSIER = {
  repo: "acme/widget",
  url: "https://warpchart.dev/r/acme/widget",
  generatedAt: "2026-10-19T12:00:00.000Z",
  window: { kind: "full" },
  registry: { rank: null, stars: 6195, velocityPerDay: null, language: "JavaScript", forks: null, nextGate: null, ahead: [], behind: [] },
  vitals: null,
  contributors: {
    total: null, authors: null, credited: null, aiCoCredits: null,
    mergedTotal: null, mergedByDistinct: null, maintainers: [], top: [],
    busFactor: null, cohorts: [], cohortsSource: "pr-sample", measuredAt: null, series: null,
  },
  usage: { npm: { package: "widget", last30: null, last30MissingDays: 0, last30Estimate: null, windowTotal: null, series: null }, clones: null, adoption: null },
  activity30d: { commits: null, prsMerged: null, issuesOpened: null, issuesClosed: null, openIssues: null, releases: [] },
  overtakes: { hunters: [], targets: [] },
};

let server;
let base;
beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url.startsWith("/api/v1/dossier") ? DOSSIER : {}));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

describe("warpchart dossier: absence is a dash, never a number", () => {
  it("prints unmeasured fields as —", async () => {
    const { stdout } = await run(process.execPath, [CLI, "dossier", "acme/widget", "--no-color"], {
      env: { ...process.env, WARPCHART_BASE: base, NO_COLOR: "1" },
    });
    const line = (label) => stdout.split("\n").find((l) => l.trim().startsWith(label)) ?? "";
    expect(line("worldwide rank")).toMatch(/#—/);
    expect(line("forks")).toMatch(/forks\s+—\s*$/);
    expect(line("merged PRs")).toMatch(/merged PRs\s+—\s+maintainers unmeasured/);
    expect(line("downloads · 30d")).toMatch(/—/);
    expect(line("commits")).toMatch(/commits\s+—\s*$/);
    expect(line("PRs merged")).toMatch(/PRs merged\s+—\s*$/);
    expect(line("issues")).toMatch(/— closed\s+— opened · — open/);
    expect(stdout).not.toMatch(/NaN|null|undefined/);
  });
});
