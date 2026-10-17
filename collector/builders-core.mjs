// BUILDERS WALL: every person who has landed work on a repo, one square each,
// in order of arrival, as an animated SVG for a README. Pure functions here
// (selection, grid, SVG); collector/builders.mjs fetches avatars and publishes.
//
// WHAT IT SHOWS. The census (collector/contributors.mjs, the `gh` map: GitHub
// accounts credited as author or co-author on the default branch, with the date
// of their first credit) minus bots and AI pairing tools. Not GitHub's sidebar
// count: the wall prints no total, only "+N this week", so the two never meet
// on the same surface.
//
// HOW IT MOVES. One loop of PERIOD seconds:
//   0-14%   the full wall (also the ONLY state under prefers-reduced-motion,
//           and what a viewer that ignores CSS animation sees)
//   14-16%  it clears
//   16-76%  it rebuilds at the REAL pace: arrival dates are mapped linearly from
//           the first arrival to `now`, then bucketed into BUCKETS steps, so a
//           slow month draws slowly and a busy one floods in
//   76-100% full again; this week's arrivals glow, the next free cell pulses
// The animation is CSS inside the SVG (same mechanism as /api/chart), which
// survives GitHub's Camo proxy. Avatars are embedded as data URIs because Camo
// serves the SVG as an image and an image cannot fetch other URLs.

// Accounts that are not people, by EXACT login (lowercase). A pattern was
// tried first and it erased real people: /claude|jules|cursor/ also matched
// "Claude42", "jules-verne", "cursor-x" (Claude and Jules are common French
// names). Bots: the same list as BOTS in contributors.mjs, plus any "[bot]".
// AI pairing tools: the logins their Co-authored-by trailers resolve to.
export const NOT_PEOPLE = new Set([
  // bots / service accounts (= BOTS in contributors.mjs)
  "github-actions", "renovate", "dependabot", "renovate-bot", "codecov", "careerops-ledger",
  // AI pairing tools seen as co-authors on GitHub
  "claude", "copilot", "cursoragent", "codex", "google-labs-jules", "devin-ai-integration",
  "openhands-agent", "chatgpt-codex-connector",
]);

export const isPerson = (login) => !!login && !NOT_PEOPLE.has(login.toLowerCase()) && !login.toLowerCase().endsWith("[bot]");

// gh: { login: { first: ISO, co: bool } } -> [{ login, first }] oldest first.
// Ties broken by login so the wall is stable between runs.
export function selectBuilders(gh, { optout = [] } = {}) {
  const out = new Set(optout.map((l) => l.toLowerCase()));
  return Object.entries(gh ?? {})
    .filter(([login, p]) => isPerson(login) && p?.first && !out.has(login.toLowerCase()))
    .map(([login, p]) => ({ login, first: p.first }))
    .sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : a.login.localeCompare(b.login)));
}

// A wide banner with at least one free cell ("the next one"). Picks the column
// count in [minCols, maxCols] that leaves the fewest empty cells, preferring
// the widest on ties so the banner stays low.
export function gridFor(n, { minCols = 56, maxCols = 76 } = {}) {
  let best = null;
  for (let cols = maxCols; cols >= minCols; cols--) {
    const rows = Math.max(1, Math.ceil((n + 1) / cols));
    const empty = rows * cols - n;
    if (!best || empty < best.empty) best = { cols, rows, empty };
  }
  return best;
}

export const PERIOD = 14;
// Below this, "N joined this week" reads as a slow week rather than movement:
// the caption switches to "latest arrival N days ago" (venture-ops, 17-oct).
export const WEEK_MIN = 5;
export const BUCKETS = 40;
const BUILD_FROM = 16;
const BUILD_SPAN = 60;

// Bucket of each person: their arrival mapped onto the build phase.
export function buckets(people, now) {
  if (!people.length) return [];
  const t0 = Date.parse(people[0].first);
  const span = Math.max(1, Date.parse(now) - t0);
  return people.map((p) => Math.min(BUCKETS - 1, Math.floor(((Date.parse(p.first) - t0) / span) * BUCKETS)));
}

export const weekCount = (people, now) =>
  people.filter((p) => Date.parse(now) - Date.parse(p.first) < 7 * 86400e3).length;

const pct = (x) => `${+x.toFixed(2)}%`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// One wall per README language. Keys are the README file suffixes
// (README.{key}.md; "en" = README.md); the value is the BCP 47 locale used for
// month names and number grouping. Copy lives in builders-messages.json.
export const LOCALES = {
  en: "en", ar: "ar", cn: "zh-CN", da: "da", de: "de", es: "es", fr: "fr", hi: "hi", id: "id",
  ja: "ja", "ko-KR": "ko-KR", pl: "pl", "pt-BR": "pt-BR", ru: "ru", ta: "ta", tr: "tr", ua: "uk",
  vi: "vi", "zh-TW": "zh-TW",
};
const RTL = new Set(["ar"]);

export const monthLabel = (ms, locale = "en") =>
  new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(ms));

// "{week}" style templates; unknown keys stay visible so a typo shows up in review
export const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

// avatars: Map login -> data URI (missing ones draw as a plain filled cell:
// the person still counts, only the picture is absent).
export function buildersSvg(people, { now, avatars = new Map(), tile = 16, msg, lang = "en" } = {}) {
  if (!msg?.title || !msg?.caption || !msg?.building || !msg?.alt) throw new Error(`builders: incomplete messages for ${lang}`);
  const locale = LOCALES[lang] ?? "en";
  const num = (x) => new Intl.NumberFormat(locale).format(x);
  const dir = RTL.has(lang) ? ' direction="rtl" unicode-bidi="embed"' : "";
  const n = people.length;
  const { cols, rows } = gridFor(n);
  const capH = 30;
  const W = cols * tile;
  const H = rows * tile + capH;
  const bk = buckets(people, now);
  const week = weekCount(people, now);
  const t0 = n ? Date.parse(people[0].first) : Date.parse(now);
  const span = Math.max(1, Date.parse(now) - t0);
  const at = (b) => BUILD_FROM + (BUILD_SPAN * b) / BUCKETS; // last bucket lands before 76%

  const css = [];
  css.push(`svg{--bg:#0d1117;--cell:#1e2633;--ink:#e6edf3;--dim:#8b949e;--ac:#f97316}`);
  css.push(`@media (prefers-color-scheme: light){svg{--bg:#ffffff;--cell:#e5e9ef;--ink:#1f2328;--dim:#59636e;--ac:#c2410c}}`);
  css.push(`text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}`);
  const used = [...new Set(bk)];
  for (const b of used) {
    const a = at(b);
    css.push(`@keyframes k${b}{0%{opacity:1}14%{opacity:0}${pct(a)}{opacity:1}}.b${b}{animation:k${b} ${PERIOD}s step-end infinite}`);
  }
  // build-phase label: one per bucket, visible until the next bucket starts
  for (let b = 0; b < BUCKETS; b++) {
    const a = at(b);
    const z = at(b + 1); // at(BUCKETS) === 76
    css.push(`@keyframes L${b}{0%{opacity:0}${pct(a)}{opacity:1}${pct(z)}{opacity:0}}.L${b}{opacity:0;animation:L${b} ${PERIOD}s step-end infinite}`);
  }
  css.push(`@keyframes cap{0%{opacity:1}14%{opacity:0}76%{opacity:1}}.cap{animation:cap ${PERIOD}s step-end infinite}`);
  css.push(`@keyframes glow{0%{opacity:1}14%{opacity:0}78%{opacity:1}86%{opacity:.3}89%{opacity:1}92%{opacity:.3}95%{opacity:1}}.wk{fill:none;stroke:var(--ac);stroke-width:2;animation:glow ${PERIOD}s step-end infinite}`);
  css.push(`@keyframes nx{0%,50%{opacity:.25}51%,100%{opacity:1}}.nx{fill:none;stroke:var(--ac);stroke-width:1.5;animation:nx 1.2s steps(1) infinite}`);
  css.push(`@media (prefers-reduced-motion: reduce){*{animation:none!important}}`);

  const cells = [];
  cells.push(`<rect width="${W}" height="${H}" fill="var(--bg)"/>`);
  // empty slots everywhere first: the wall reads as being built on a grid
  for (let i = 0; i < rows * cols; i++) {
    const x = (i % cols) * tile, y = Math.floor(i / cols) * tile;
    cells.push(`<rect x="${x + 1}" y="${y + 1}" width="${tile - 2}" height="${tile - 2}" fill="var(--cell)"/>`);
  }
  const recent = new Set(people.map((p, i) => (Date.parse(now) - Date.parse(p.first) < 7 * 86400e3 ? i : -1)).filter((i) => i >= 0));
  people.forEach((p, i) => {
    const x = (i % cols) * tile, y = Math.floor(i / cols) * tile;
    const src = avatars.get(p.login);
    const inner = src
      ? `<image href="${src}" x="${x}" y="${y}" width="${tile}" height="${tile}" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect x="${x}" y="${y}" width="${tile}" height="${tile}" fill="var(--dim)"/>`;
    cells.push(`<g class="b${bk[i]}"><title>@${esc(p.login)}</title>${inner}</g>`);
  });
  for (const i of recent) {
    const x = (i % cols) * tile, y = Math.floor(i / cols) * tile;
    cells.push(`<rect class="wk" x="${x + 1}" y="${y + 1}" width="${tile - 2}" height="${tile - 2}"/>`);
  }
  if (n < rows * cols) {
    const x = (n % cols) * tile, y = Math.floor(n / cols) * tile;
    cells.push(`<rect class="nx" x="${x + 1.5}" y="${y + 1.5}" width="${tile - 3}" height="${tile - 3}"/>`);
  }

  const y0 = rows * tile + 20;
  const lastDays = n ? Math.max(0, Math.floor((Date.parse(now) - Date.parse(people[n - 1].first)) / 86400e3)) : 0;
  const ago = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-lastDays, "day");
  const vars = { since: n ? monthLabel(t0, locale) : "", week: num(week), n: num(n), ago };
  // title on the reading-start side, live caption on the other (mirrored in RTL)
  // In RTL text-anchor is logical: "start" is the RIGHT edge. So only the x
  // positions swap; anchors stay (an LTR-style "end" at W-8 drew off-canvas).
  const [xa, aa, xb, ab] = dir ? [W - 8, "start", 8, "end"] : [8, "start", W - 8, "end"];
  const text = [];
  text.push(`<text x="${xa}" y="${y0}" font-size="14" font-weight="700" text-anchor="${aa}" fill="var(--ink)"${dir}>${esc(fill(msg.title, vars))}</text>`);
  text.push(`<text class="cap" x="${xb}" y="${y0}" font-size="13" text-anchor="${ab}" fill="var(--ac)"${dir}>${esc(fill(week >= WEEK_MIN || !msg.captionQuiet ? msg.caption : msg.captionQuiet, vars))}</text>`);
  for (let b = 0; b < BUCKETS; b++) {
    const tb = t0 + (span * (b + 1)) / BUCKETS;
    const shown = bk.filter((x) => x <= b).length;
    text.push(`<text class="L${b}" x="${xb}" y="${y0}" font-size="13" text-anchor="${ab}" fill="var(--ac)"${dir}>${esc(fill(msg.building, { ...vars, month: monthLabel(tb, locale), n: num(shown) }))}</text>`);
  }

  const label = fill(msg.alt, vars);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">` +
    `<title>${esc(label)}</title><style>${css.join("")}</style>${cells.join("")}${text.join("")}</svg>`;
}
