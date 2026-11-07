import crypto from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A server failure has to leave a line someone can find: Next's error digest,
// tied to a JSON log line, and never a cause the page guessed.

let lines: Record<string, unknown>[];
const capture = (...args: unknown[]) => {
  const s = String(args[0]);
  if (s.startsWith("{")) lines.push(JSON.parse(s));
};

beforeEach(() => {
  lines = [];
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/history");
  vi.doUnmock("@/lib/github");
  delete process.env.POLAR_WEBHOOK_SECRET;
});

describe("onRequestError", () => {
  // What React hands Next for a Server Component that throws in production:
  // a generic message plus the digest the error boundary shows the reader.
  it("logs a thrown render error as one JSON line carrying its digest", async () => {
    const { onRequestError } = await import("@/instrumentation");
    const err = Object.assign(new Error("An error occurred in the Server Components render."), {
      digest: "2417319935",
    });
    await onRequestError(
      err,
      { path: "/r/acme/rocket?vault=0f6c-secret", method: "GET", headers: { "x-vercel-id": "cdg1::abc" } },
      {
        routerKind: "App Router",
        routePath: "/r/[owner]/[name]",
        routeType: "render",
        renderSource: "react-server-components",
        revalidateReason: undefined,
      },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      scope: "server",
      event: "request.failed",
      digest: "2417319935",
      path: "/r/acme/rocket",
      routePath: "/r/[owner]/[name]",
      routeType: "render",
      vercelId: "cdg1::abc",
    });
    expect(typeof lines[0].reqId).toBe("string");
    expect(JSON.stringify(lines[0])).not.toContain("secret");
  });
});

describe("error boundaries", () => {
  const error = Object.assign(new Error("An error occurred in the Server Components render."), {
    digest: "2417319935",
  });
  const props = { error, reset: () => {}, unstable_retry: () => {} };

  it("the explorer's boundary shows the digest and does not blame GitHub", async () => {
    const { default: ExplorerError } = await import("@/app/r/[owner]/[name]/error");
    const html = renderToStaticMarkup(createElement(ExplorerError, props));
    expect(html).toContain("2417319935");
    expect(html).not.toMatch(/github/i);
  });

  it("a root-layout failure has its own boundary, with the digest", async () => {
    const { default: GlobalError } = await import("@/app/global-error");
    const html = renderToStaticMarkup(createElement(GlobalError, props));
    expect(html).toMatch(/^<html/);
    expect(html).toContain("2417319935");
  });
});

describe("per-request logging", () => {
  // The monitor cron used one module-scoped logger, so every tick a warm
  // instance served logged under the same reqId.
  it("gives every monitor tick its own reqId", async () => {
    vi.doMock("@/lib/history", () => ({ lastSnapshot: () => ({ ts: new Date().toISOString() }) }));
    vi.doMock("@/lib/github", () => ({ lowFuel: () => false }));
    const { GET } = await import("@/app/api/monitor/route");
    await GET(new Request("http://localhost/api/monitor"));
    await GET(new Request("http://localhost/api/monitor"));
    const ticks = lines.filter((l) => l.scope === "monitor" && l.event === "tick");
    expect(ticks).toHaveLength(2);
    expect(ticks[0].reqId).not.toBe(ticks[1].reqId);
  });

  // A paid order whose checkout carried no usable repo answers 200 (a retry
  // cannot fix it) and, with no ALERT_WEBHOOK_URL, used to leave no trace.
  it("records a paid order with no valid repo", async () => {
    vi.doMock("@/lib/tenants-store", () => ({ readTenantsBlob: vi.fn(), writeTenantsBlob: vi.fn() }));
    vi.doMock("@/lib/email", () => ({ sendEmail: vi.fn() }));
    vi.doMock("@/lib/history", () => ({ loadRoute: vi.fn() }));
    vi.doMock("@/lib/live-blob", () => ({ writeLiveSnapshot: vi.fn() }));
    process.env.POLAR_WEBHOOK_SECRET = "polar-test-secret";
    const body = JSON.stringify({
      type: "order.paid",
      data: {
        id: "ord_7f3a",
        custom_field_data: { "github-repo": "https://github.com/acme/rocket" },
        customer: { email: "buyer@example.com" },
        product: { name: "Pro" },
      },
    });
    const id = "msg_1";
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac("sha256", "polar-test-secret").update(`${id}.${ts}.${body}`).digest("base64");
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/polar/webhook/route");
    const res = await POST(
      new NextRequest("http://localhost/api/polar/webhook", {
        method: "POST",
        body,
        headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
      }),
    );
    expect(res.status).toBe(200);
    const line = lines.find((l) => l.event === "order.paid.no-repo");
    expect(line).toMatchObject({ level: "error", scope: "polar", order: "ord_7f3a", notified: false });
    expect(JSON.stringify(lines)).not.toContain("buyer@example.com");
  });
});
