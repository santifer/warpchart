// IndexNow: tell Bing + Yandex to recrawl the corpus when it changes, so new
// charted repos and the daily rank/velocity updates get indexed in hours
// instead of waiting for an organic crawl. (Google ignores IndexNow but reads
// the sitemap; this complements it.) Key file lives in /public and is publicly
// fetchable, which is how IndexNow verifies ownership.
//
// Idempotent per UTC day via a stamp synced in data/, so the daily route
// refresh triggers exactly one submission. Never fails the collect run.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./lib.mjs";

const KEY = "4fe7309d88a7ba14689422376780e3ba";
const HOST = "warpchart.dev";
const BASE = `https://${HOST}`;
const STATIC = ["", "/codex", "/velocity", "/find", "/compare", "/pricing", "/methodology", "/docs"];
const TOP = 300; // a sane daily batch of the highest-rank consoles
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const STAMP = join(DATA_DIR, "indexnow-stamp.txt");

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  if (existsSync(STAMP) && readFileSync(STAMP, "utf8").trim() === today) {
    console.log(`[indexnow] already submitted for ${today}, skipping`);
    return;
  }
  const routePath = join(DATA_DIR, "route.json");
  if (!existsSync(routePath)) return;
  const route = JSON.parse(readFileSync(routePath, "utf8"));
  const repos = (route.repos ?? [])
    .slice(0, TOP)
    .map((p) => p.r)
    .filter((r) => REPO_RE.test(r))
    .map((r) => `${BASE}/r/${r}`);
  const urlList = [...STATIC.map((p) => `${BASE}${p}`), ...repos];

  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `${BASE}/${KEY}.txt`, urlList }),
  });
  console.log(`[indexnow] submitted ${urlList.length} URLs -> HTTP ${res.status}`);
  if (res.ok || res.status === 202) writeFileSync(STAMP, today);
}

main().catch((err) => {
  console.error(`[indexnow] failed (non-fatal): ${err?.message ?? err}`);
  process.exit(0);
});
