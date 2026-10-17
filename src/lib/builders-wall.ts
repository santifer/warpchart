// Read one language of the builders wall from the private Blob.
// Only a FOUND wall returns: "not found" throws WallMissing and a transient
// error rethrows, so a caller wrapped in unstable_cache never stores either
// (a cached "not found" pinned ?lang=es / ?lang=pt-BR to English for an hour
// on 17-oct-2026, after their walls existed).
import { BlobNotFoundError, type get as blobGet } from "@vercel/blob";

export class WallMissing extends Error {}

export async function loadWall(get: typeof blobGet, token: string | undefined, slug: string, lang: string): Promise<string> {
  if (!token) throw new WallMissing("no token");
  let res;
  try {
    res = await get(`builders/${slug}.${lang}.svg`, { access: "private", token, useCache: false });
  } catch (e) {
    if (e instanceof BlobNotFoundError || (e as Error)?.name === "BlobNotFoundError") throw new WallMissing(lang);
    throw e;
  }
  if (res?.statusCode === 200 && res.stream) return await new Response(res.stream).text();
  if (!res) throw new WallMissing(lang); // the SDK's not-found shape
  throw new Error(`blob status ${res.statusCode}`);
}
