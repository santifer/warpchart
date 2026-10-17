// Publishes the BUILDERS WALL (collector/builders-core.mjs) for the house repo:
// reads the contributor census from the private Blob, fetches every avatar,
// renders the animated SVG and writes it next to a small meta file:
//   builders/{owner}--{name}.{lang}.svg  one per README language, served by /api/builders?lang=
//   builders/{owner}--{name}.json        { people, week, langs, generatedAt, censusUpdatedAt, avatarsMissing, bytes }
// Copy per language: collector/builders-messages.json (a language missing
// there is simply not rendered; the route falls back to en).
//
// Runs on its own workflow (builders.yml), never inside collect.yml: a slow
// avatar CDN must not eat the moat collector's time budget.
//
// VALIDATE BEFORE WRITING. The previous wall stays published (and a partial
// marker is left for the watchdog) when: the census is missing; it lost more
// people than a small tolerance (an account deleted or an opt-out is normal,
// dozens gone is a bad read; --force overrides, and who left is logged); more
// than 5% of the avatars failed (grey squares are worse than yesterday's
// wall); or the SVG passes MAX_BYTES (Next's data cache silently drops entries
// over 2 MB, and the route caches it).
//
// Usage: BLOB_READ_WRITE_TOKEN=... node collector/builders.mjs [--force] [--out file.svg]
import { readFileSync, writeFileSync } from "node:fs";
import { readConfig } from "./lib.mjs";
import { readFresh, markPartial, markComplete } from "./blob.mjs";
import { createHash } from "node:crypto";
import { selectBuilders, buildersSvg, weekCount, isPerson, LOCALES } from "./builders-core.mjs";

const MESSAGES = JSON.parse(readFileSync(new URL("./builders-messages.json", import.meta.url), "utf8"));

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token && !OUT) {
  console.log("[builders] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

const config = readConfig();
const repo = config.repo;
const slug = repo.toLowerCase().replace("/", "--");
const FAMILY = "builders";
const AVATAR_PX = 32; // the cell is 16 units; 32 px keeps it sharp on retina
const MAX_BYTES = 1.8 * 1024 * 1024; // ~1,500 people at ~1.2 KB each
// a census rebuilds from scratch each run: people can legitimately disappear
const shrinkTolerance = (prev) => Math.max(3, Math.ceil(prev * 0.01));

async function avatar(sharp, login) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=${AVATAR_PX * 2}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const jpg = await sharp(buf).flatten({ background: "#ffffff" }).resize(AVATAR_PX, AVATAR_PX, { fit: "cover" })
        .jpeg({ quality: 72, mozjpeg: true }).toBuffer();
      return `data:image/jpeg;base64,${jpg.toString("base64")}`;
    } catch {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

async function main() {
  const census = token ? await readFresh(`contributors/${slug}.json`) : null;
  if (!census?.gh) {
    console.log(`[builders] no census for ${repo}; previous wall kept`);
    if (token) await markPartial(FAMILY, { repo, reason: "census missing" });
    return;
  }
  const prev = token ? await readFresh(`builders/${slug}.json`) : null;
  // "this week" is measured from the census, not from when this job happened to run
  const now = census.updated_at ?? new Date().toISOString();
  const excluded = Object.keys(census.gh).filter((l) => !isPerson(l));
  const people = selectBuilders(census.gh, { optout: config.builders_optout ?? [] });
  const logins = people.map((p) => p.login);
  const hash = createHash("sha256").update(logins.join("\n")).digest("hex").slice(0, 16);
  console.log(`[builders] census ${census.updated_at}: ${people.length} people; not people: ${excluded.join(", ") || "none"}`);
  // Self-gate: same people and a wall younger than 20 h -> only "this week"
  // could move, and it is re-rendered at least once a day anyway.
  if (!FORCE && prev && prev.hash === hash && Date.now() - Date.parse(prev.generatedAt) < 20 * 3600e3) {
    console.log(`[builders] same ${people.length} people as the wall of ${prev.generatedAt}; skipped`);
    return;
  }
  if (prev?.logins) {
    const now_ = new Set(logins);
    const gone = prev.logins.filter((l) => !now_.has(l));
    if (gone.length) console.log(`[builders] left since the last wall: ${gone.join(", ")}`);
    if (gone.length > shrinkTolerance(prev.logins.length) && !FORCE) {
      console.log(`[builders] REFUSED: ${gone.length} people gone (tolerance ${shrinkTolerance(prev.logins.length)}); a bad census read? re-run with --force if real`);
      await markPartial(FAMILY, { repo, reason: `${gone.length} people gone since the last wall` });
      return;
    }
  }

  const { default: sharp } = await import("sharp");
  const avatars = new Map();
  let missing = 0;
  const queue = [...people];
  await Promise.all(Array.from({ length: 16 }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const uri = await avatar(sharp, p.login);
      if (uri) avatars.set(p.login, uri);
      else missing++;
    }
  }));
  if (missing > people.length * 0.05) {
    console.log(`[builders] REFUSED: ${missing} of ${people.length} avatars failed`);
    if (token) await markPartial(FAMILY, { repo, reason: `${missing}/${people.length} avatars failed` });
    return;
  }

  // every language renders before anything is written: a broken entry in the
  // messages file must not leave half the READMEs on a new wall
  const langs = Object.keys(LOCALES).filter((l) => MESSAGES[l]);
  const svgs = new Map(langs.map((lang) => [lang, buildersSvg(people, { now, avatars, msg: MESSAGES[lang], lang })]));
  const bytes = Math.max(...[...svgs.values()].map((x) => Buffer.byteLength(x)));
  if (bytes > MAX_BYTES) {
    console.log(`[builders] REFUSED: ${(bytes / 1024).toFixed(0)} KB > ${(MAX_BYTES / 1024).toFixed(0)} KB; lower AVATAR_PX or the JPEG quality`);
    if (token) await markPartial(FAMILY, { repo, reason: `svg ${bytes} bytes > ${MAX_BYTES}` });
    return;
  }
  const meta = {
    repo,
    people: people.length,
    hash,
    logins,
    week: weekCount(people, now),
    langs,
    avatarsMissing: missing,
    bytes,
    generatedAt: new Date().toISOString(), // when the wall was rendered (freshness)
    measuredAt: now, // the census instant "this week" is counted from
    censusUpdatedAt: census.updated_at ?? null,
  };
  if (OUT) for (const [lang, svg] of svgs) writeFileSync(OUT.replace(/\.svg$/, `.${lang}.svg`), svg);
  if (token && !OUT) {
    const { put } = await import("@vercel/blob");
    const opts = { access: "private", token, addRandomSuffix: false, allowOverwrite: true };
    // SVGs first, meta last: the meta is the commit point the watchdog trusts
    for (const [lang, svg] of svgs) await put(`builders/${slug}.${lang}.svg`, svg, { ...opts, contentType: "image/svg+xml" });
    await put(`builders/${slug}.json`, JSON.stringify(meta), { ...opts, contentType: "application/json" });
    // a language dropped from the messages file must not keep serving a wall
    // frozen on its last "joined this week"
    const { list, del } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: `builders/${slug}.`, token });
    const stale = blobs.map((b) => b.pathname).filter((k) => k.endsWith(".svg") && !langs.includes(k.slice(`builders/${slug}.`.length, -4)));
    if (stale.length) { await del(stale, { token }); console.log(`[builders] removed retired languages: ${stale.join(", ")}`); }
    await markComplete(FAMILY, { repo });
  }
  console.log(`[builders] ${repo}: ${meta.people} people, ${meta.week} this week, ${langs.length} languages (${langs.join(" ")}), ${missing} avatars missing, ${(meta.bytes / 1024).toFixed(0)} KB each`);
}

main().catch((e) => {
  console.error("[builders] failed:", e?.message ?? e);
  process.exitCode = 1;
});
