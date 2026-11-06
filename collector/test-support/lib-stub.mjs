// The real lib.mjs, except topReposDeep returns STUB_DEEP made-up repos (named
// so they hash into all 32 route-history shards).
export * from "../lib.mjs";

export async function topReposDeep(limit = 10000) {
  const n = Math.min(Number(process.env.STUB_DEEP ?? 0), limit);
  return Array.from({ length: n }, (_, i) => ({ r: `owner${i}/repo-${i.toString(36)}`, s: 100000 - i }));
}
