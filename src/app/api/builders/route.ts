// BUILDERS WALL embed: every person who has landed work on the repo, one square
// each, in order of arrival, as an animated SVG for a README.
//   /api/builders                      -> the house repo, English
//   /api/builders?lang=es              -> the same wall with the Spanish copy
// Cache-only: the SVG is rendered by collector/builders.mjs (builders.yml) into
// the private Blob; a view never touches GitHub. A language without its own
// copy falls back to English rather than breaking the README image.
import { get } from "@vercel/blob";
import { loadWall, WallMissing } from "@/lib/builders-wall";
import { unstable_cache } from "next/cache";
import { REPO } from "@/lib/config";
import { canonicalRepo } from "@/lib/aliases";
import { embedCache } from "@/lib/embed";
import { reqLog } from "@/lib/log";

export const dynamic = "force-dynamic";

// README language keys (README.{key}.md), matched case-insensitively so
// ?lang=pt-br or ?lang=ES still get their wall instead of a broken image.
const LANGS = ["en", "ar", "cn", "da", "de", "es", "fr", "hi", "id", "ja", "ko-KR", "pl", "pt-BR", "ru", "ta", "tr", "ua", "vi", "zh-TW"];
const LANG_BY_LOWER = new Map(LANGS.map((l) => [l.toLowerCase(), l]));

// Blob get() is CDN-cached for weeks unless told otherwise; the wall changes
// daily, so read from origin and let this 30-min cache absorb the traffic.
// NOTHING but a found wall is cached (see loadWall). Known trade-off: once a
// language is cached, deleting its SVG does not demote it to English until the
// entry expires and a revalidation succeeds; Next serves the stale copy if the
// background revalidation throws. builders.mjs only deletes a language when it
// is dropped from the messages file, which is a deliberate act.
const readWall = unstable_cache(
  (slug: string, lang: string) => loadWall(get, process.env.BLOB_READ_WRITE_TOKEN, slug, lang),
  ["builders-wall-v2"],
  { revalidate: 1800 },
);
const readWallOrNull = (slug: string, lang: string) =>
  readWall(slug, lang).catch((e) => {
    if (e instanceof WallMissing) return null;
    throw e;
  });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repo = canonicalRepo(url.searchParams.get("repo") ?? REPO);
  const lang0 = LANG_BY_LOWER.get((url.searchParams.get("lang") ?? "en").toLowerCase()) ?? "en";
  const log = reqLog("builders", { repo, lang: lang0 });
  // only the house repo has a wall; anything else never reaches the Blob
  if (repo.toLowerCase() !== REPO.toLowerCase()) {
    return new Response("no builders wall for this repo", { status: 404, headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
  }
  const slug = repo.toLowerCase().replace("/", "--");
  let lang = lang0;
  let svg: string | null;
  try {
    svg = await readWallOrNull(slug, lang);
    if (!svg && lang !== "en") {
      lang = "en";
      svg = await readWallOrNull(slug, lang);
    }
  } catch (e) {
    log.error("blob", e);
    // no-store: the next view retries instead of a cached failure
    return new Response("builders wall temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!svg) {
    log.info("miss", {});
    // short cache: a wall that is being generated for the first time shows up soon
    return new Response("no builders wall yet", { status: 404, headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } });
  }
  // one line per load: how often READMEs pull the wall (Camo = GitHub views), per language
  log.info("hit", { served: lang, camo: /camo/i.test(req.headers.get("user-agent") ?? "") });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // a fallback is a stand-in: keep it short so the real language replaces it
      "Cache-Control": lang === lang0 ? embedCache(3600, 86_400) : "public, max-age=300, s-maxage=300",
      "Content-Language": lang,
      "x-warp-request": log.reqId,
    },
  });
}
