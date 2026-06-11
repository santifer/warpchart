// Structured server logging: one JSON line per event, queryable straight
// from Vercel ("vercel logs --json | jq") or any log drain. Every request
// gets a short id that is echoed in the x-warp-request response header, so
// a user-reported failure correlates to its exact server trace.
//
//   const log = reqLog("explorer", { repo });
//   log.info("velocity.resolved", { neighbors: 19, ms: 412 });
//   log.warn("graphql.partial", { failedAliases: 2, kinds: ["NOT_FOUND"] });
//   const data = await log.time("sample", () => sampleCurve(o, n));
//
// LOG_LEVEL env: debug | info (default) | warn | error.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
  return ORDER[lvl] ?? 20;
}

function emit(level: Level, scope: string, event: string, fields: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    scope,
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      err: err.message.slice(0, 400),
      errName: err.name,
      cause: err.cause instanceof Error ? err.cause.message.slice(0, 200) : undefined,
    };
  }
  return { err: String(err).slice(0, 400) };
}

export interface Log {
  reqId: string;
  debug: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, err?: unknown, fields?: Record<string, unknown>) => void;
  time: <T>(event: string, fn: () => Promise<T>, fields?: Record<string, unknown>) => Promise<T>;
}

export function reqLog(scope: string, base: Record<string, unknown> = {}): Log {
  const reqId = Math.random().toString(36).slice(2, 10);
  const ctx = { reqId, ...base };
  const log: Log = {
    reqId,
    debug: (event, fields = {}) => emit("debug", scope, event, { ...ctx, ...fields }),
    info: (event, fields = {}) => emit("info", scope, event, { ...ctx, ...fields }),
    warn: (event, fields = {}) => emit("warn", scope, event, { ...ctx, ...fields }),
    error: (event, err, fields = {}) =>
      emit("error", scope, event, { ...ctx, ...serializeError(err), ...fields }),
    time: async (event, fn, fields = {}) => {
      const t0 = Date.now();
      try {
        const out = await fn();
        emit("info", scope, event, { ...ctx, ...fields, ms: Date.now() - t0, ok: true });
        return out;
      } catch (err) {
        emit("error", scope, event, {
          ...ctx,
          ...fields,
          ms: Date.now() - t0,
          ok: false,
          ...serializeError(err),
        });
        throw err;
      }
    },
  };
  return log;
}
