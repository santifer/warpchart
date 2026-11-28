#!/usr/bin/env node
// Pre-render on production what collect.mjs planned (see warm-core.mjs). Its
// own step with its own cap: every response is read to the end and bounded
// (drainFetch: an unread /api/og response once kept Node alive for 23 min),
// the whole phase stops when its budget is spent, and the step can never cost
// the run its deploy.
//
// Usage: WARM_BASE_URL=https://... node collector/warm.mjs
import { readFileSync, existsSync } from "node:fs";
import { drainFetch, budget } from "./lib.mjs";
import { WARM_PLAN } from "./warm-core.mjs";

const TIMEOUT_MS = Number(process.env.WARM_TIMEOUT_MS) || 30_000;
// under the step's 3-minute cap, so the summary line always prints
const BUDGET_MS = Number(process.env.WARM_BUDGET_MS) || 150_000;
const base = (process.env.WARM_BASE_URL ?? "").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!base) {
  console.log("[warm] no WARM_BASE_URL, skipping");
  process.exit(0);
}
const plan = existsSync(WARM_PLAN) ? JSON.parse(readFileSync(WARM_PLAN, "utf8")) : [];
if (!plan.length) {
  console.log("[warm] nothing planned this run");
  process.exit(0);
}
let warmed = 0;
let tried = 0;
const b = budget(BUDGET_MS);
for (const { path, pauseMs } of plan) {
  if (b.spent()) break;
  tried++;
  const r = await drainFetch(`${base}${path}`, {}, TIMEOUT_MS);
  if (r.ok) warmed++;
  else console.warn(`[warm] ${path} -> ${r.status ? `HTTP ${r.status}` : r.error === "timeout" ? `no answer in ${TIMEOUT_MS / 1000}s` : r.error}`);
  await sleep(pauseMs ?? 0);
}
console.log(`[warm] ${warmed}/${plan.length} pages warmed${tried < plan.length ? ` (budget spent after ${tried})` : ""}`);
