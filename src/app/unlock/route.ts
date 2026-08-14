// Owner-only "god mode" unlock: stashes the secret keys in localStorage so the
// private panels can fetch their gated APIs from this browser only.
//   /unlock?k=<WARPCHART_GOD_KEY>  -> rank history for ANY repo   (GodRank)
//   /unlock?v=<VAULT_KEY>          -> the private Traffic Vault   (TrafficPanel)
//   /unlock?k=..&v=..              -> both at once
//   /unlock?clear=1                -> forget both
// Two separate slots on purpose: they gate different data behind different
// secrets, so a key handed out for one must never open the other.
// Keys are never validated here (each API validates every request); this route
// only parks the token client-side. Kept out of /r/ so the public explorer
// never reads a cookie and keeps its ISR cache.
export const dynamic = "force-dynamic";

// inline-script safe: an accidental "</script>" inside a key would otherwise
// close the tag and drop the rest of the page.
const js = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c");

function page(script: string, msg: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex">` +
      `<body style="margin:0;background:#06080c;color:#53d6e8;font:13px ui-monospace,monospace;` +
      `display:flex;align-items:center;justify-content:center;height:100vh;letter-spacing:.18em">` +
      `god mode: ${msg}<script>try{${script}}catch(e){}location.replace("/")</script></body>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  if (sp.get("clear")) {
    return page(`localStorage.removeItem("wc_god");localStorage.removeItem("wc_vault")`, "LOCKED");
  }
  const k = sp.get("k") ?? "";
  const v = sp.get("v") ?? "";
  if (!k && !v) return page("", "NO KEY");
  const script = [
    k ? `localStorage.setItem("wc_god",${js(k)})` : "",
    v ? `localStorage.setItem("wc_vault",${js(v)})` : "",
  ]
    .filter(Boolean)
    .join(";");
  const msg = k && v ? "UNLOCKED · RANK + VAULT" : k ? "UNLOCKED · RANK" : "UNLOCKED · VAULT";
  return page(script, msg);
}
