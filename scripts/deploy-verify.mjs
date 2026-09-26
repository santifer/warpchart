#!/usr/bin/env node
// deploy-verify — "done" means verified on what production SERVES, never an
// exit code. A green workflow, a passing build or a finished `vercel --prod`
// proved nothing on its own here: the Data Cache outlives deploys (15 min of
// unstable_cache), `git push` does not deploy, and a fix can land in the wrong
// code path. This fetches the real page and checks the literal text.
//
//   node scripts/deploy-verify.mjs --url=/r/career-ops-hq/career-ops \
//     --expect="through Sep 25" [--expect=...] [--absent=...] [--wait=15] [--no-health]
//
// Prints one `VERIFICADO:` line with the evidence, or `NO VERIFICADO:` and exits 1.
// Zero dependencies (Node 22 fetch).

const args = process.argv.slice(2);
const opt = (k) => args.filter((a) => a.startsWith(`--${k}=`)).map((a) => a.slice(k.length + 3));
const flag = (k) => args.includes(`--${k}`);

const base = (opt("base")[0] ?? "https://warpchart.dev").replace(/\/$/, "");
const path = opt("url")[0] ?? "/";
const url = /^https?:/.test(path) ? path : base + (path.startsWith("/") ? path : `/${path}`);
const expect = opt("expect");
const absent = opt("absent");
const waitMin = Number(opt("wait")[0] ?? 0);
const checkHealth = !flag("no-health");

if (!expect.length && !absent.length && !checkHealth) {
  console.error("usage: deploy-verify --url=/path --expect=\"text\" [--absent=\"text\"] [--wait=min] [--no-health]");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe() {
  const res = await fetch(url, { headers: { "user-agent": "warpchart-deploy-verify" }, redirect: "follow" });
  const html = await res.text();
  const missing = expect.filter((t) => !html.includes(t));
  const present = absent.filter((t) => html.includes(t));
  return {
    status: res.status,
    cache: res.headers.get("x-vercel-cache") ?? "-",
    age: res.headers.get("age") ?? "-",
    missing,
    present,
    ok: res.ok && !missing.length && !present.length,
  };
}

async function health() {
  const res = await fetch(`${base}/api/health`, { headers: { "user-agent": "warpchart-deploy-verify" } });
  const j = await res.json().catch(() => null);
  return {
    ok: res.ok && j?.ok === true,
    detail: j ? `ok=${j.ok} lastSnapshot=${j.collector?.lastSnapshot ?? "?"} (${j.collector?.ageMinutes ?? "?"} min)` : `HTTP ${res.status}`,
  };
}

const deadline = Date.now() + waitMin * 60_000;
let p;
for (;;) {
  p = await probe().catch((e) => ({ ok: false, status: "ERR", cache: "-", age: "-", missing: expect, present: [], err: String(e?.message ?? e) }));
  if (p.ok || Date.now() >= deadline) break;
  console.log(`… not yet (${p.missing.length ? `missing ${JSON.stringify(p.missing)}` : `still present ${JSON.stringify(p.present)}`}; cache ${p.cache}, age ${p.age}s). Retrying in 60 s`);
  await sleep(60_000);
}
const h = checkHealth ? await health().catch((e) => ({ ok: false, detail: String(e?.message ?? e) })) : { ok: true, detail: "skipped" };

const evidence = [
  `${url} → HTTP ${p.status}, x-vercel-cache ${p.cache}, age ${p.age}s`,
  ...expect.map((t) => `${p.missing.includes(t) ? "✗ missing" : "✓ contains"} ${JSON.stringify(t)}`),
  ...absent.map((t) => `${p.present.includes(t) ? "✗ still contains" : "✓ no longer contains"} ${JSON.stringify(t)}`),
  `/api/health: ${h.detail}`,
];
const ok = p.ok && h.ok;
console.log(`${ok ? "VERIFICADO" : "NO VERIFICADO"}: ${evidence.join(" · ")}${p.err ? ` · error ${p.err}` : ""}`);
process.exit(ok ? 0 : 1);
