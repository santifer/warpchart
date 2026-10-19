// Sticky earned-badges store: one small JSON in the PRIVATE Blob, deliberately
// NOT under data/ so it never touches the moat sync or the build pipeline. The
// /api/cron/badges job writes it once a day (a UNION — only ever adds a key the
// first time a repo earns it, with the date). Every render reads it cached. A
// miss returns {} and badges degrade to live-only: nothing breaks.
import { get } from "@vercel/blob";
import { unstable_cache } from "next/cache";
import type { EarnedBadges } from "./badges";
import { updateJson, keepsEveryKey } from "./blob";

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

// The cron writer: a union into the freshest store (updateJson reads from
// origin and throws on anything but a 404). It used to read through read()
// above, where a 503 is {}: the union then started from nothing and the write
// replaced every earned date with today's. Returns how many pairs were new.
export async function recordEarnedBadges(active: { r: string; key: string }[], today: string) {
  let added = 0;
  const { value } = await updateJson<EarnedBadges>(PATH, (stored) => {
    const map = structuredClone(stored ?? {});
    added = 0;
    for (const { r, key } of active) {
      const lk = r.toLowerCase();
      map[lk] ??= {};
      if (!map[lk][key]) {
        map[lk][key] = today;
        added++;
      }
    }
    if (!added) return undefined;
    keepsEveryKey(stored, map, PATH);
    return map;
  });
  return { added, repos: Object.keys(value ?? {}).length };
}
