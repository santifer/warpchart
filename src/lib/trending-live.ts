// Server-side read of the live Trending record (collector/trending-marks.mjs ->
// private Blob trending/marks.json). Rewritten every collect run, so it is read
// from origin (useCache: false: the Blob CDN would serve a weeks-old copy).
// Only the god-key /api/v1/velocity-rank reads it, so no data cache either.
// Any failure is null: the panel then shows the archive alone and its footnote
// stops at the archive's date, never "checked, not there".
import { get } from "@vercel/blob";
import type { TrendingLiveRecord } from "./trending-marks";

export async function readTrendingLive(): Promise<TrendingLiveRecord | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const res = await get("trending/marks.json", { access: "private", token, useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return JSON.parse(await new Response(res.stream).text()) as TrendingLiveRecord;
  } catch {
    return null;
  }
}
