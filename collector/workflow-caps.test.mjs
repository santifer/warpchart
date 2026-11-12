import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A job-level timeout cancels every remaining step, continue-on-error
// included. That is how 'Trigger deploy' died on 2026-07-19 and on
// 2026-09-21/24/26: the step caps added up to 38 minutes against a 25-minute
// job cap, and nine steps had no cap at all. These rules make a step cap fire
// before the job cap, and keep the deploy out of reach of either.

// Just enough YAML for our own workflow files: jobs at 2 spaces, their keys at
// 4, steps at 6 ("- "), step keys at 8.
function parseJobs(text) {
  const jobs = {};
  let job = null;
  let step = null;
  let inJobs = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) inJobs = line.startsWith("jobs:");
    if (!inJobs || /^\s*#/.test(line)) continue;
    let m;
    if ((m = /^ {2}([\w-]+):\s*$/.exec(line))) {
      job = jobs[m[1]] = { steps: [] };
      step = null;
    } else if (job && (m = /^ {4}([\w-]+):\s*(.*)$/.exec(line)) && m[1] !== "steps") {
      job[m[1]] = m[2];
    } else if (job && (m = /^ {6}- (.*)$/.exec(line))) {
      step = { label: m[1] };
      job.steps.push(step);
      const kv = /^([\w-]+):\s*(.*)$/.exec(m[1]);
      if (kv) step[kv[1]] = kv[2];
    } else if (step && (m = /^ {8}([\w-]+):\s*(.*)$/.exec(line))) {
      step[m[1]] = m[2];
    }
  }
  return jobs;
}

const collect = parseJobs(readFileSync(new URL("../.github/workflows/collect.yml", import.meta.url), "utf8"));
const name = (s) => s.name ?? s.uses ?? s.run ?? s.label;

describe("collect.yml caps", () => {
  it("reads both jobs (the parser is not silently empty)", () => {
    expect(Object.keys(collect)).toEqual(["snapshot", "deploy"]);
    expect(collect.snapshot.steps.length).toBeGreaterThan(15);
  });

  for (const [id, job] of Object.entries(collect)) {
    it(`${id}: every step has its own timeout-minutes`, () => {
      const uncapped = job.steps.filter((s) => !Number(s["timeout-minutes"])).map(name);
      expect(uncapped).toEqual([]);
    });

    it(`${id}: the step caps add up to less than the job cap`, () => {
      const sum = job.steps.reduce((t, s) => t + Number(s["timeout-minutes"] ?? 0), 0);
      expect(Number(job["timeout-minutes"])).toBeGreaterThan(sum);
    });
  }

  it("'Trigger deploy' is its own job and runs whatever happened to the snapshot", () => {
    expect(collect.snapshot.steps.map(name)).not.toContain("Trigger deploy");
    expect(collect.deploy.steps.map(name)).toContain("Trigger deploy");
    expect(collect.deploy.needs).toBe("snapshot");
    expect(collect.deploy.if).toBe("always()");
  });

  it("the production cache warm is its own capped step, not part of 'Collect snapshot'", () => {
    const steps = collect.snapshot.steps;
    const snap = steps.find((s) => s.name === "Collect snapshot");
    expect(snap.env ?? "").not.toMatch(/WARM/);
    expect(readFileSync(new URL("./collect.mjs", import.meta.url), "utf8")).not.toMatch(/\bfetch\(`\$\{base\}/);
    const warm = steps.find((s) => s.name === "Warm production cache");
    expect(warm.run).toBe("node collector/warm.mjs");
    expect(warm["continue-on-error"]).toBe("true");
  });
});
