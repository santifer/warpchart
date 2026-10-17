import { describe, expect, it } from "vitest";
import { BlobNotFoundError } from "@vercel/blob";
import { loadWall, WallMissing } from "./builders-wall";

const svgRes = () => ({ statusCode: 200, stream: new Response("<svg/>").body }) as never;

describe("loadWall: only a found wall may be cached", () => {
  it("returns the SVG", async () => {
    expect(await loadWall((async () => svgRes()) as never, "t", "o--r", "es")).toBe("<svg/>");
  });
  it("THROWS on not-found (null), so unstable_cache cannot pin the English fallback (es/pt-BR, 17-oct)", async () => {
    await expect(loadWall((async () => null) as never, "t", "o--r", "es")).rejects.toBeInstanceOf(WallMissing);
  });
  it("THROWS on BlobNotFoundError too", async () => {
    await expect(loadWall((async () => { throw new BlobNotFoundError(); }) as never, "t", "o--r", "es")).rejects.toBeInstanceOf(WallMissing);
  });
  it("rethrows a transient error as itself (503, not a missing wall)", async () => {
    const e = new Error("boom");
    await expect(loadWall((async () => { throw e; }) as never, "t", "o--r", "es")).rejects.toBe(e);
  });
});
