// GitHub auth pool: a GitHub App installation token (its own 5,000/h
// budget) with the classic PAT as automatic failover, plus a global
// LOW FUEL flag so the long tail stops burning calls when either budget
// runs dry. Creating a GitHub App is free; in the paid phase each tenant
// installs it and brings their own quota.
import { createSign } from "node:crypto";
import { reqLog } from "@/lib/log";

const log = reqLog("ghauth");

interface Budget {
  remaining: number;
  resetAt: number; // ms epoch when the window resets
}

// Per-instance budget tracking (Fluid reuses instances, so this is shared
// across many requests in practice).
const budgets: Record<"app" | "pat", Budget> = {
  app: { remaining: Infinity, resetAt: 0 },
  pat: { remaining: Infinity, resetAt: 0 },
};

const LOW_FUEL_FLOOR = 500;

function fresh(b: Budget): number {
  return Date.now() > b.resetAt ? Infinity : b.remaining;
}

export function noteRateLimit(source: "app" | "pat", remaining: number, resetEpochSec: number) {
  budgets[source] = { remaining, resetAt: resetEpochSec * 1000 };
}

// True when EVERY available token is nearly exhausted: callers serving the
// long tail should fall back to caches and registries instead of erroring.
export function lowFuel(): boolean {
  const appConfigured = !!process.env.GITHUB_APP_ID;
  const appLeft = appConfigured ? fresh(budgets.app) : 0;
  const patLeft = fresh(budgets.pat);
  return Math.max(appLeft, patLeft) < LOW_FUEL_FLOOR;
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

// App JWT (RS256, no deps) -> installation access token, cached until
// shortly before its 1h expiry. A single in-flight mint is shared.
let cached: { token: string; expiresAt: number } | null = null;
let minting: Promise<string> | null = null;

async function mintInstallationToken(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID!;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID!;
  const key = (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // iat 60s in the past tolerates clock skew (GitHub rejects future iat)
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const jwt = `${header}.${payload}.${b64url(signer.sign(key))}`;

  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "warpchart",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`app token mint failed: ${res.status} ${(await res.text()).slice(0, 120)}`);
  const body = (await res.json()) as { token: string; expires_at: string };
  cached = { token: body.token, expiresAt: Date.parse(body.expires_at) - 5 * 60_000 };
  log.info("app-token.minted", { expiresAt: body.expires_at });
  return body.token;
}

async function appToken(): Promise<string | null> {
  if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY || !process.env.GITHUB_APP_INSTALLATION_ID) {
    return null;
  }
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  try {
    minting ??= mintInstallationToken().finally(() => {
      minting = null;
    });
    return await minting;
  } catch (err) {
    log.warn("app-token.failed", { err: (err as Error).message.slice(0, 160) });
    return null;
  }
}

export interface AuthChoice {
  token: string;
  source: "app" | "pat";
}

// Prefer the App's budget while it has fuel; fail over to the PAT when the
// App is unconfigured, exhausted or unmintable. Throws only when nothing
// is configured at all.
export async function pickAuth(): Promise<AuthChoice> {
  const pat = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  if (fresh(budgets.app) >= LOW_FUEL_FLOOR || !pat || fresh(budgets.pat) < LOW_FUEL_FLOOR) {
    const t = await appToken();
    if (t) return { token: t, source: "app" };
  }
  if (!pat) throw new Error("Missing GITHUB_TOKEN env var (and no GitHub App configured)");
  return { token: pat, source: "pat" };
}
