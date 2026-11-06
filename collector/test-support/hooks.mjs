// Module hooks for blob-harness.mjs: @vercel/blob becomes the stub, and
// route-history gets a lib.mjs whose deep sweep is canned (no GitHub search).
const BLOB = new URL("./blob-stub.mjs", import.meta.url).href;
const LIB = new URL("./lib-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === "@vercel/blob") return { url: BLOB, shortCircuit: true };
  if (specifier === "./lib.mjs" && context.parentURL?.endsWith("/collector/route-history.mjs")) {
    return { url: LIB, shortCircuit: true };
  }
  return next(specifier, context);
}
