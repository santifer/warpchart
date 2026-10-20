// Owner-only "god mode" unlock: stashes the secret keys in localStorage so the
// private panels can fetch their gated APIs from this browser only.
//   /unlock?k=<WARPCHART_GOD_KEY>  -> rank history for ANY repo   (GodRank)
//   /unlock?v=<VAULT_KEY>          -> the private Traffic Vault   (TrafficPanel)
//   /unlock?k=..&v=..              -> both at once
//   /unlock?m=<one-time token>     -> a magic link (scripts/god-magic-link.mjs):
//                                     GET shows a button, POST redeems it once
//   /unlock?clear=1                -> forget both
// Two separate slots on purpose: they gate different data behind different
// secrets, so a key handed out for one must never open the other.
// Keys are never validated here (each API validates every request); this route
// only parks the token client-side. Kept out of /r/ so the public explorer
// never reads a cookie and keeps its ISR cache.
import { redeemMagic, TOKEN_RE } from "@/lib/magic-link";

export const dynamic = "force-dynamic";

// inline-script safe: an accidental "</script>" inside a key would otherwise
// close the tag and drop the rest of the page.
const js = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c");
const HEAD =
  `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<meta name="referrer" content="no-referrer">`;
const BODY =
  `<body style="margin:0;background:#06080c;color:#53d6e8;font:13px ui-monospace,monospace;` +
  `display:flex;flex-direction:column;gap:18px;align-items:center;justify-content:center;height:100vh;letter-spacing:.18em">`;
const HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, private" };

function page(script: string, msg: string): Response {
  return new Response(
    `${HEAD}${BODY}god mode: ${msg}<script>try{${script}}catch(e){}location.replace("/")</script></body>`,
    { headers: HEADERS },
  );
}

// The magic link's landing page: nothing is redeemed on GET, because link
// previews (iMessage, WhatsApp, Slack) fetch the URL before the human taps it
// and would burn a one-time link. A preview never submits a form.
function confirmPage(m: string): Response {
  return new Response(
    `${HEAD}${BODY}<div>god mode · one-time link</div>` +
      `<form method="post" action="/unlock"><input type="hidden" name="m" value="${m}">` +
      `<button style="background:none;border:1px solid #53d6e8;color:#53d6e8;padding:12px 20px;font:inherit;letter-spacing:.2em;cursor:pointer">` +
      `UNLOCK THIS DEVICE</button></form>` +
      `<div style="color:#5b6b7d;font-size:11px">works once · expires soon</div></body>`,
    { headers: HEADERS },
  );
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  if (sp.get("clear")) {
    return page(`localStorage.removeItem("wc_god");localStorage.removeItem("wc_vault")`, "LOCKED");
  }
  const m = sp.get("m") ?? "";
  if (m) return TOKEN_RE.test(m) ? confirmPage(m) : page("", "LINK USED OR EXPIRED");
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

// Redeems a magic link: one use, then it is gone. The same answer for an
// unknown, used or expired link.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const m = String(form?.get("m") ?? "");
  const god = process.env.WARPCHART_GOD_KEY ?? "";
  const vault = process.env.VAULT_KEY ?? "";
  // a misconfigured server must not burn the link for nothing
  if (!god) return page("", "NOT CONFIGURED");
  const grant = await redeemMagic(m);
  if (!grant) return page("", "LINK USED OR EXPIRED");
  const script = [
    `localStorage.setItem("wc_god",${js(god)})`,
    grant.vault && vault ? `localStorage.setItem("wc_vault",${js(vault)})` : "",
  ]
    .filter(Boolean)
    .join(";");
  return page(script, grant.vault && vault ? "UNLOCKED · RANK + VAULT" : "UNLOCKED · RANK");
}
