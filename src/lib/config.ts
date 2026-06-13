import config from "../../mission.config.json";

export const REPO: string = config.repo;
export const [OWNER, NAME] = REPO.split("/");
export const ACCENT: string = (config as { accent?: string }).accent ?? "cyan";

// Privileged owners: every repository under these accounts is unlocked (full
// console) by virtue of ownership, no tenants.json entry needed, and the
// collector auto-discovers + tracks their non-fork repos. This is the
// "enterprise owner" model: santifer's whole portfolio is his, always tracked.
export const OWNED_BY: string[] = ((config as { owned_by?: string[] }).owned_by ?? [OWNER])
  .map((o) => o.toLowerCase());

export function isOwnedBy(owner: string): boolean {
  return OWNED_BY.includes(owner.toLowerCase());
}
