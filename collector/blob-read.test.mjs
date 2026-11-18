import { describe, expect, it } from "vitest";
import { readJsonStrict } from "./blob-read.mjs";

const body = (o) => new Response(JSON.stringify(o)).body;
describe("readJsonStrict: an error is never read as empty", () => {
  it("404 is null (not there yet)", async () => {
    expect(await readJsonStrict(async () => ({ statusCode: 404 }), "k")).toBeNull();
  });
  it("a 503 throws instead of returning null (the write-back would erase the shard)", async () => {
    await expect(readJsonStrict(async () => ({ statusCode: 503 }), "k")).rejects.toThrow(/503/);
  });
  it("a network error throws", async () => {
    await expect(readJsonStrict(async () => { throw new Error("ECONNRESET"); }, "k")).rejects.toThrow(/ECONNRESET/);
  });
  it("reads from origin by default (useCache false)", async () => {
    let seen = null;
    await readJsonStrict(async (_k, o) => ((seen = o), { statusCode: 200, stream: body({ a: 1 }) }), "k");
    expect(seen.useCache).toBe(false);
  });
  it("200 parses", async () => {
    expect(await readJsonStrict(async () => ({ statusCode: 200, stream: body({ a: 1 }) }), "k")).toEqual({ a: 1 });
  });
});
