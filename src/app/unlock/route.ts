// Owner-only "god mode" unlock: stashes the secret key in localStorage so the
// private competitor panels (GodRank) can fetch the gated rank-history API.
//   /unlock?k=<secret>   -> store the token, then go home
//   /unlock?clear=1      -> forget it
// The key is never validated here (the API validates every request); this route
// only parks the token client-side. Kept out of /r/ so the public explorer
// never reads a cookie and keeps its ISR cache.
export const dynamic = "force-dynamic";

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
    return page(`localStorage.removeItem("wc_god")`, "LOCKED");
  }
  const k = sp.get("k") ?? "";
  if (!k) return page("", "NO KEY");
  return page(`localStorage.setItem("wc_god", ${JSON.stringify(k)})`, "UNLOCKED");
}
