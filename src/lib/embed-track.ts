// Embed adoption tracking. When a repo's README (or any GitHub markdown) shows
// the Warpchart embed, GitHub fetches the image through its camo proxy, so a
// request to /api/chart or /api/badge with a camo User-Agent means the embed is
// LIVE on GitHub, and ?repo= tells us which one. We record the first sighting
// per repo in the private Blob and fire ONE notification (email via Resend if
// configured, else the Discord/Slack alert webhook). Called from after() so it
// never delays the image response.
import { get, put } from "@vercel/blob";

const KEY = "embeds/seen.json";
// per-instance short-circuit so we hit the Blob at most once per repo per warm
// instance (the Blob remains the durable dedup source of truth)
const seenMem = new Set<string>();

type SeenMap = Record<string, { at: string; surface: string }>;

async function readSeen(token: string): Promise<SeenMap> {
  try {
    const res = await get(KEY, { access: "private", token });
    if (res?.statusCode === 200 && res.stream) {
      return JSON.parse(await new Response(res.stream).text()) as SeenMap;
    }
  } catch {
    /* first run / transient */
  }
  return {};
}

async function notify(repo: string, surface: string, count: number) {
  const subject = `WARPCHART embed live on GitHub: ${repo}`;
  const text =
    `${repo} just rendered the Warpchart ${surface} embed on GitHub (served through camo), ` +
    `the first time we have seen it. Their README now carries a live link back to warpchart.dev. ` +
    `That is embed #${count} tracked.\n\nConsole: https://warpchart.dev/r/${repo}`;

  const resendKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (resendKey && to) {
    const from = process.env.ALERT_EMAIL_FROM || "WARPCHART <embeds@warpchart.dev>";
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject, text }),
      });
      return;
    } catch {
      /* fall through to webhook */
    }
  }

  const hook = process.env.ALERT_WEBHOOK_URL;
  if (hook) {
    const body = hook.includes("slack.com") ? { text: `📌 ${text}` } : { content: `📌 ${text}` };
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
  }
}

// GitHub's image proxy identifies as "Camo Asset Proxy ..." / "github-camo ...".
function isCamo(ua: string | null): boolean {
  return !!ua && /camo/i.test(ua);
}

// Returns a short status (surfaced as the x-embed response header) so the
// pipeline can be diagnosed from a single request without logs.
export async function noteEmbedHit(
  ua: string | null,
  repo: string | null,
  surface: "chart" | "badge",
): Promise<string> {
  if (!repo) return "no-repo";
  if (!isCamo(ua)) return "not-camo";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return "bad-repo";
  const key = repo.toLowerCase();
  if (seenMem.has(key)) return "mem-seen";

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    seenMem.add(key); // no durable store: at least do not re-notify this instance
    return "no-token";
  }

  const seen = await readSeen(token);
  if (seen[key]) {
    seenMem.add(key);
    return "blob-seen";
  }
  seen[key] = { at: new Date().toISOString(), surface };
  try {
    await put(KEY, JSON.stringify(seen), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token,
    });
  } catch (e) {
    return "write-failed:" + (e instanceof Error ? e.message.slice(0, 60) : "err");
  }
  seenMem.add(key);
  try {
    await notify(repo, surface, Object.keys(seen).length);
  } catch {
    return "written-no-notify";
  }
  return "written";
}
