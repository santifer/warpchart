import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_ENDPOINTS, API_PRIVATE, CLI_COMMANDS, MCP_TOOLS, commandName, endpointPath } from "./surface";

// The documented surface against the code that serves it. Before surface.ts the
// README's MCP list was missing get_rising and recommend, /api/v1 did not list
// dossier or badges, and /docs promised --json on commands that ignore it.
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the public surface is listed once, and matches the code", () => {
  it("lists every /api/v1 route (private ones accounted for)", () => {
    const routes = readdirSync(join(ROOT, "src/app/api/v1"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const listed = API_ENDPOINTS.map((e) => endpointPath(e).replace("/api/v1/", ""));
    expect([...listed, ...API_PRIVATE].sort()).toEqual(routes);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("lists exactly the tools the MCP server registers", () => {
    const src = read("src/app/api/[transport]/route.ts");
    const registered = [...src.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(registered.length).toBeGreaterThan(0);
    expect(MCP_TOOLS.map((t) => t.name).sort()).toEqual(registered);
  });

  it("lists exactly the commands in the CLI's help", () => {
    const src = read("cli/warpchart.mjs");
    const help = [...src.matchAll(/warpchart \$\{accent\("([^"]+)"\)\}/g)].map((m) => m[1]).sort();
    expect(help.length).toBeGreaterThan(0);
    expect(CLI_COMMANDS.map(commandName).sort()).toEqual(help);
  });

  it("claims --json only for the commands that honour it", () => {
    // each branch of main(): `cmd === "dossier" || ...` up to the next branch
    const main = read("cli/warpchart.mjs").split("async function main()")[1];
    const honours = new Set<string>();
    for (const branch of main.split("} else if (")) {
      if (!/asJson\)/.test(branch)) continue;
      const name = branch.match(/cmd === "([a-z]+)"/)?.[1] ?? (/\.test\(cmd\)/.test(branch) ? "<owner/name>" : null);
      if (name) honours.add(name);
    }
    const claimed = CLI_COMMANDS.filter((c) => c.json).map(commandName).sort();
    expect(claimed).toEqual([...honours].sort());
  });
});
