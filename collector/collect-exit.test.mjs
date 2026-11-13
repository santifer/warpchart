import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

// #34 (2026-11-13): three collector runs (7-nov ×2, 11-nov) were CANCELLED at
// the 25-minute job cap. Each one hung right after "[collect] spotlight warmed":
// collect.mjs had finished, but the unread /api/og response kept its
// connection, and Node, alive. The deploy step never ran and the health
// watchdog stayed red for a week.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// A real server, no mocks: headers arrive, then the body never ends.
function endlessServer() {
  return new Promise((resolve) => {
    const sockets = new Set();
    const srv = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.write("\x89PNG");
    });
    srv.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
    srv.listen(0, "127.0.0.1", () => resolve({
      url: `http://127.0.0.1:${srv.address().port}/api/og?repo=a%2Fb`,
      close: () => new Promise((ok) => { for (const s of sockets) s.destroy(); srv.close(ok); }),
    }));
  });
}

describe("drainFetch: side-effect fetches that cannot keep the process alive", () => {
  it("gives up on a body that never ends, on its own clock", async () => {
    const { drainFetch } = await import("./lib.mjs");
    const srv = await endlessServer();
    try {
      const t = Date.now();
      const r = await drainFetch(srv.url, {}, 200);
      expect(r).toEqual({ ok: false, status: null, error: "timeout" });
      expect(Date.now() - t).toBeLessThan(1500);
    } finally {
      await srv.close();
    }
  }, 5000);

  it("reads the body to the end (an unread body is the bug)", async () => {
    let res;
    vi.stubGlobal("fetch", vi.fn(async () => (res = new Response("png bytes", { status: 200 }))));
    const { drainFetch } = await import("./lib.mjs");
    expect(await drainFetch("https://warpchart.dev/api/og?repo=a%2Fb")).toEqual({ ok: true, status: 200, error: null });
    expect(res.bodyUsed).toBe(true);
  });

  it("never throws, and says why it failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const { drainFetch } = await import("./lib.mjs");
    expect(await drainFetch("https://hooks.example/x", { method: "POST" })).toEqual({ ok: false, status: null, error: "fetch failed" });
  });
});

describe("budget: a best-effort phase cannot add up past the job's cap", () => {
  it("is spent once its time has passed", async () => {
    const { budget } = await import("./lib.mjs");
    let t = 1000;
    const b = budget(180_000, () => t);
    expect(b.spent()).toBe(false);
    t += 179_999;
    expect(b.spent()).toBe(false);
    t += 1;
    expect(b.spent()).toBe(true);
  });
});

describe("the collector's warm loops only fetch through drainFetch", () => {
  // strip block comments and whole-line comments only: a `//` inside a URL
  // string must not hide the code after it
  const code = (f) => readFileSync(new URL(f, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const f of ["./collect.mjs", "./collisions.mjs"]) {
    it(`${f} has no bare fetch() whose body could be left unread`, () => {
      expect(code(f).match(/(?<![\w.])fetch\(/g) ?? []).toEqual([]);
    });
  }
  it("collect.mjs ends with a self-reporting exit guard that never delays a clean exit", () => {
    expect(code("./collect.mjs")).toMatch(/kept the process alive[\s\S]*process\.exit\([\s\S]*\.unref\(\)/);
  });
});
