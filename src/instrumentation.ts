// Server error capture. Next calls onRequestError for every error it catches
// on the server: a render that throws (the digest the error boundary shows is
// the key back to this line), a route handler, a server action, the proxy.
// One JSON line in the reqLog shape, so `vercel logs --json | jq` finds it.
//
// The query string is dropped on purpose: ?vault= and ?key= carry secrets.
import type { Instrumentation } from "next";
import { reqLog } from "@/lib/log";

export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const digest = (err as { digest?: unknown } | null)?.digest;
  const vercelId = request.headers["x-vercel-id"];
  reqLog("server").error("request.failed", err, {
    digest: typeof digest === "string" ? digest : null,
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
    vercelId: typeof vercelId === "string" ? vercelId : undefined,
  });
};
