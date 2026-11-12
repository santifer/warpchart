#!/usr/bin/env node
// Pre-render on production what collect.mjs planned (see warm-core.mjs). Its
// own step with its own cap: a render that never answers is abandoned after
// WARM_TIMEOUT_MS, and the step can never cost the run its deploy.
//
// Usage: WARM_BASE_URL=https://... node collector/warm.mjs
import { readFileSync, existsSync } from "node:fs";
import { WARM_PLAN } from "./warm-core.mjs";

const TIMEOUT_MS = Number(process.env.WARM_TIMEOUT_MS) || 30_000;
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
for (const { path, pauseMs } of plan) {
  try {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) warmed++;
    else console.warn(`[warm] ${path} -> HTTP ${res.status}`);
  } catch (err) {
    console.warn(`[warm] ${path} failed: ${err?.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000}s` : err?.message}`);
  }
  await sleep(pauseMs ?? 0);
}
console.log(`[warm] ${warmed}/${plan.length} pages warmed`);
