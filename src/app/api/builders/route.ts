// BUILDERS WALL embed: every person who has landed work on the repo, one square
// each, in order of arrival, as an animated SVG for a README.
//   /api/builders                      -> the house repo, English
//   /api/builders?lang=es              -> the same wall with the Spanish copy
// Cache-only: the SVG is rendered by collector/builders.mjs (builders.yml) into
// the private Blob; a view never touches GitHub. A language without its own
// copy falls back to English rather than breaking the README image.
import { get, BlobNotFoundError } from "@vercel/blob";
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
// Only a definite "not found" returns null: a transient error THROWS, and
// unstable_cache does not store a throw, so one bad read cannot pin a broken
// image on every README for half an hour.
const readWall = unstable_cache(
  async (slug: string, lang: string): Promise<string | null> => {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return null;
    try {
      const res = await get(`builders/${slug}.${lang}.svg`, { access: "private", token, useCache: false });
      if (res?.statusCode === 200 && res.stream) return await new Response(res.stream).text();
      if (!res) return null; // the SDK's not-found shape
      throw new Error(`blob status ${res.statusCode}`);
    } catch (e) {
      if (e instanceof BlobNotFoundError || (e as Error)?.name === "BlobNotFoundError") return null;
      throw e;
    }
  },
  ["builders-wall-v1"],
  { revalidate: 1800 },
);

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
    svg = await readWall(slug, lang);
    if (!svg && lang !== "en") {
      lang = "en";
      svg = await readWall(slug, lang);
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
      "Cache-Control": embedCache(3600, 86_400),
      "Content-Language": lang,
      "x-warp-request": log.reqId,
    },
  });
}
