// Sticky earned-badges store: one small JSON in the PRIVATE Blob, deliberately
// NOT under data/ so it never touches the moat sync or the build pipeline. The
// /api/cron/badges job writes it once a day (a UNION — only ever adds a key the
// first time a repo earns it, with the date). Every render reads it cached. A
// miss returns {} and badges degrade to live-only: nothing breaks.
import { get, put } from "@vercel/blob";
import { unstable_cache } from "next/cache";
import type { EarnedBadges } from "./badges";

const PATH = "badges-earned.json";

async function read(): Promise<EarnedBadges> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return {};
  try {
    const res = await get(PATH, { access: "private", token });
    if (!res || res.statusCode !== 200 || !res.stream) return {};
    const j = JSON.parse(await new Response(res.stream).text());
    return j && typeof j === "object" ? (j as EarnedBadges) : {};
  } catch {
    return {};
  }
}

// The render path: cached so a page reads the store at most once per hour (it
// only changes once a day).
export async function loadEarnedBadges(): Promise<EarnedBadges> {
  return unstable_cache(read, ["earned-badges"], { revalidate: 3600 })();
}

// The cron writer must see the freshest store before unioning, so it bypasses
// the render cache.
export function readEarnedBadgesFresh(): Promise<EarnedBadges> {
  return read();
}

export async function saveEarnedBadges(map: EarnedBadges): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  await put(PATH, JSON.stringify(map), {
    access: "private",
    token,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}
