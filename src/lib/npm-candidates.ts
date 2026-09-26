import { allNamesOf } from "./aliases";

// npm package names to try for a repo, best first: the repo's own PUBLIC
// package name, then the conventional scoped name @owner/name for EVERY name
// the repo has carried, canonical first. After the 2026-08-31 transfer the
// owner became career-ops-hq, so the only scoped guess was
// @career-ops-hq/career-ops, which does not exist: the installer is still
// published as @santifer/career-ops. npm answered a clean 404 and the panel
// silently fell back to clones only for three weeks. A transfer renames the
// repo, never the package.
export function npmCandidates(owner: string, name: string, rootPkg: string | null): string[] {
  const names = allNamesOf(`${owner}/${name}`);
  return [
    ...new Set([
      ...(rootPkg ? [rootPkg] : []),
      ...[...names].reverse().map((full) => `@${full.toLowerCase()}`),
    ]),
  ];
}
