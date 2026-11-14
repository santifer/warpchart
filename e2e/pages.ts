// The public surfaces a visitor lands on, each with a literal text that only
// the page's OWN content renders: not the layout (its JSON-LD names the site),
// not the masthead (it reads WARPCHART · COMPARE · WARP INDEX · PRICING), not
// an error shell or an empty skeleton. Shared with the selftest, which proves
// none of them matches the layout and masthead alone.
export const PAGES: { path: string; expect: RegExp }[] = [
  // a leaderboard row ("awesome #2 · 521K ★"): the registry really loaded
  { path: "/", expect: /#\d+ · [\d.]+[KM]? ★/ },
  // the house tenant's full mission console, directly and via its alias
  { path: "/r/career-ops-hq/career-ops", expect: /PR flow/i },
  { path: "/console", expect: /PR flow/i },
  // deep space: outside the top-10k registry, so the page is built from a
  // live scan, the path whose server render can throw behind a 200 (the same
  // small, stable foreign repo collector/health.mjs uses; keep it small)
  { path: "/r/chalk/ansi-styles", expect: /sits #[\d,]+ of every public repository/i },
  { path: "/velocity", expect: /surging right now/i },
  { path: "/pricing", expect: /own the growth record/i },
  { path: "/methodology", expect: /how warpchart measures open source/i },
  { path: "/compare", expect: /race readout/i },
];
