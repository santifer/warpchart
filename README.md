# Warpchart

**[:gb: English](#what-it-is)** | **[:es: Español](#es-versión-en-español)**

> Growth telemetry for any GitHub repository. A live star chart of your repo's journey through the worldwide ranking, with sound.

https://github.com/user-attachments/assets/1b04b08e-7154-4123-a1a5-184227882cf8

*The landing galaxy: every light is a real top-1000 repository at its real log-scale position. Click any system to warp into its full telemetry console.*

**[Live demo](https://warpchart.dev)** (tracking [career-ops](https://github.com/santifer/career-ops) as example tenant) · **[Scan any repo instantly](https://warpchart.dev/r/tinygrad/tinygrad)** by changing the URL: `/r/owner/name`

## What it is

GitHub gives you raw star data but no cockpit. Star history charts are static, Trending is a black box, and nobody shows you the repos around yours in the worldwide ranking, how fast they move, or when you pass them.

Warpchart turns the public GitHub API into a live flight console:

- **Status bar**: stars, worldwide rank, stars in the last 60 minutes, today vs yesterday at the same hour, gap and ETA to the next rank milestone. Polls every minute.
- **Star chart**: a two-band space map. The local system is a pannable zoom window (lateral scroll to pan, pinch to zoom) showing your ranking neighbors with overtake ETAs. The route to the core maps every milestone between you and the worldwide #1 repo, where every dot is a real top 1000 repository. A viewport bracket links both bands.
- **Scan cards**: hover any repo on the chart for a game-style temporal card with its avatar, description, velocity, gap and overtake date. Click to pin it as chase target with a persistent HUD.
- **Sound**: a fully synthesized Web Audio soundscape, zero audio files. Each new star is a sonar ping, ambient pad brightness follows velocity, milestone crossings play a quiet fanfare. Off by default, one click to enable. Leave the tab open and hear your repo grow.
- **Velocity, daily ladder, cumulative, heatmap, rank over time**: the full instrument panel, including the night-floor line that tells compounding growth apart from a decaying spike.
- **Replay**: re-draw the whole journey from day zero in 36 seconds, scrubber included. With sound on, ping density follows each moment's velocity.
- **Spike forensics**: every star spike is correlated with Hacker News posts, Reddit posts and your own releases, then annotated on the daily chart and in the log. The dashboard does not just show the spike, it tells you what likely caused it.
- **Mission log**: auto-detected events from telemetry. Milestone gates, neighbor overtakes, daily records, spike causes, plus a daily captain's line.
- **Engagement percentile**: your fork/star ratio ranked against the worldwide top 1000 (a real-usage signal, not a popularity one).
- **Alerts**: set an optional `ALERT_WEBHOOK_URL` secret (Discord or Slack incoming webhook) and the hourly collector notifies you of milestone gates and overtakes. There is also an RSS feed of the mission log at `/feed.xml`.
- **Mission briefing**: come back after 18 hours and get a one-line delta summary since your last visit. Stored client-side, no accounts.

### Shareable everywhere

**Embeddable badge** (SVG, edge-cached, updates hourly, adapts to light and dark automatically):

```markdown
[![World rank](https://warpchart.dev/api/badge?repo=OWNER/NAME)](https://warpchart.dev/r/OWNER/NAME)
```

Both the badge and the chart accept `?theme=light|dark` to pin a scheme, for GitHub's picture pattern:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://warpchart.dev/api/badge?theme=dark">
  <img alt="World rank" src="https://warpchart.dev/api/badge?theme=light">
</picture>
```

**Embeddable ANIMATED chart, for any repository** (the line draws itself on every README view: pure SVG animation, no JavaScript, survives GitHub's image proxy). Always wrap it in a link so readers can click through to the full live telemetry:

```html
<a href="https://warpchart.dev/r/OWNER/NAME">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://warpchart.dev/api/chart?repo=OWNER/NAME&theme=dark">
    <img alt="Live star telemetry" src="https://warpchart.dev/api/chart?repo=OWNER/NAME&theme=light" loading="lazy">
  </picture>
</a>
```

For the instance's own tracked repo, drop `?repo=` (exact archived history instead of sampled) and point the link at your repo's /r/owner/name route. A copy-paste generator for any repo lives at `/explore`.

**Instant explorer** for any repo, no setup: `/r/owner/name`. **Dynamic Open Graph cards**: every shared link renders a live stats card.

## API, MCP & CLI

The same telemetry is exposed three ways for developers and agents. All of it is **public, free and cache-only**: it never makes a GitHub call per request, so it is fast and rate-limit-proof. Per-repository historical telemetry is the separate hosted product.

### REST API — `/api/v1`

```bash
curl "https://warpchart.dev/api/v1/repo?repo=vuejs/core"          # rank, velocity, neighbours, next gate
curl "https://warpchart.dev/api/v1/leaderboard?language=Rust"     # biggest repos, optionally by language
curl "https://warpchart.dev/api/v1/velocity?limit=20&language=Go" # fastest movers, optionally by language
curl "https://warpchart.dev/api/v1/overtakes?repo=d3/d3"          # who is hunting a repo (and who it's about to pass)
curl "https://warpchart.dev/api/v1/compare?repos=vuejs/core,react/react"
curl "https://warpchart.dev/api/v1/embed?repo=OWNER/NAME"         # README embed snippet
```

`GET /api/v1` is a self-documenting index. Use the canonical `owner/name` (e.g. `react/react`); repos outside the worldwide top-1000 return 404 (no live fetch). `/api/v1/overtakes` is global without `?repo=`.

### MCP server — `/api/mcp`

A streamable-HTTP MCP server so your agent can query the leaderboard. Tools: `get_repo_stats`, `get_leaderboard`, `get_velocity_rankings`, `get_active_overtakes` (pass `repo` for who's hunting it), `compare_repos`, `get_embed_snippet`. Add it to any MCP client (Claude Desktop, Cursor, ...):

```json
{ "mcpServers": { "warpchart": { "url": "https://warpchart.dev/api/mcp" } } }
```

For stdio-only clients, wrap it with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{ "mcpServers": { "warpchart": { "command": "npx", "args": ["-y", "mcp-remote", "https://warpchart.dev/api/mcp"] } } }
```

### CLI — `npx warpchart`

```bash
npx warpchart vuejs/core              # rank, velocity, a braille star chart + who's hunting it
npx warpchart hunters d3/d3           # who's about to pass it (and who it's about to pass)
npx warpchart top 20 --lang Rust      # the biggest repos, optionally by language
npx warpchart velocity --lang Go      # the fastest-growing repos right now
npx warpchart compare react/react vuejs/core
npx warpchart embed OWNER/NAME        # a README embed snippet
npx warpchart vuejs/core --json       # raw JSON (agent friendly)
```

Source in [`cli/`](cli/); point it at another instance with `WARPCHART_BASE`.

## How it works

```
GitHub Actions cron (hourly)              Vercel (Next.js)
  collector/collect.mjs                     static page rebuilt on each snapshot
  snapshot -> data/history.jsonl            + live API routes (edge cached)
  commit -> push -> auto redeploy           + /api/badge + /api/og + /r/ explorer
```

A one-time bootstrap walks your entire stargazer history (one timestamp per star) and measures your worldwide rank, milestone thresholds and ranking neighbors. From then on an hourly GitHub Action appends snapshots; every commit redeploys the site. The live API routes are edge-cached, so visitor traffic never multiplies GitHub API cost.

No database. No paid APIs. No collector secrets (it uses the automatic Actions token).

### The watchdog

A telemetry product is only worth the trust you can place in it, and the failure that matters is not a crash: it is the site confidently showing a number that stopped being true. So `collector/health.mjs` runs every two hours against production and asserts what a person would otherwise have to remember to check: that the data is actually recent, that the numbers are possible at all (nothing gains or loses 5% of its stars a day as growth), that upstreams still answer what they answered last run, that the endpoints a visitor touches still respond for repos we do not own, and that the same repo shows the same velocity on every surface.

Findings carry a remedy, not just an alarm, and land in a single auto-updating GitHub issue that closes itself on recovery. Run it yourself against any instance:

```bash
node collector/health.mjs --base=https://your-instance.vercel.app --no-fail
```

## Tech Stack

![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_v4-06B6D4?style=flat&logo=tailwindcss&logoColor=white)
![React](https://img.shields.io/badge/React_19-61DAFB?style=flat&logo=react&logoColor=black)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=flat&logo=githubactions&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat&logo=vercel&logoColor=white)

## Five minute setup

1. Use this repository as a template.
2. Edit `mission.config.json`:

```json
{ "repo": "owner/name", "accent": "cyan" }
```

3. Run the bootstrap: Actions tab, run the `bootstrap` workflow (optionally passing the repo as input). Or locally: `GH_TOKEN=$(gh auth token) node collector/bootstrap.mjs`, then commit `data/`.
4. Import the repo in Vercel and add one env var: `GITHUB_TOKEN` (a fine-grained PAT with read-only access to public repositories, used by the live routes).
5. Done. The hourly `collect` workflow keeps history growing and redeploys automatically.

Local development:

```bash
npm install
GITHUB_TOKEN=$(gh auth token) npm run dev
```

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Some good first issues are listed in [docs/good-first-issues.md](docs/good-first-issues.md).

## License

MIT

---

# :es: Versión en Español

> Telemetría de crecimiento para cualquier repositorio de GitHub. Una carta estelar en vivo del viaje de tu repo por el ranking mundial, con sonido.

https://github.com/user-attachments/assets/1b04b08e-7154-4123-a1a5-184227882cf8

*La galaxia de la portada: cada luz es un repositorio real del top 1000 en su posición logarítmica real. Haz clic en cualquier sistema para saltar a su consola de telemetría completa.*

**[Demo en vivo](https://warpchart.dev)** (siguiendo a [career-ops](https://github.com/santifer/career-ops) como tenant de ejemplo) · **Escanea cualquier repo al instante** cambiando la URL: `/r/owner/name`

## Qué es

GitHub te da los datos de stars en crudo pero no la cabina de mandos. Las gráficas de histórico son estáticas, Trending es una caja negra y nadie te enseña los repos que rodean al tuyo en el ranking mundial, a qué velocidad van ni cuándo los adelantas.

Warpchart convierte la API pública de GitHub en una consola de vuelo:

- **Barra de estado** en vivo: stars, rank mundial, últimos 60 minutos, hoy contra ayer a la misma hora, distancia y ETA al siguiente hito.
- **Carta estelar** de dos bandas: sistema local paneable (rueda lateral para moverte, pinch para zoom) con tus vecinos de ranking y sus ETAs de adelantamiento, y la ruta al núcleo donde cada puntito es un repo real del top 1000 mundial. Un corchete-viewport conecta ambas bandas.
- **Scan cards**: hover sobre cualquier repo para una ventanita temporal estilo videojuego con avatar, descripción, velocidad y fecha de adelantamiento. Click para fijarlo como objetivo de caza con HUD persistente.
- **Sonido** 100% sintetizado con Web Audio, cero ficheros: cada star nueva es un ping de sónar, el pad ambiental sigue la velocidad y cruzar un hito suena a fanfarria serena. Apagado por defecto. Deja la pestaña abierta y escucha crecer tu repo.
- **Velocidad, escalera diaria, acumulada, heatmap, rank en el tiempo**: el panel de instrumentos completo, incluido el suelo nocturno que distingue crecimiento compuesto de pico que se apaga.
- **Replay**: el viaje entero desde el día cero en 36 segundos, con scrubber. Con sonido, la densidad de pings sigue la velocidad de cada momento.
- **Mission log**: eventos auto-detectados (hitos, adelantamientos, récords diarios) más una línea diaria de bitácora.
- **Briefing diario**: vuelve tras 18 horas y te resume los deltas desde tu última visita. Todo en el cliente, sin cuentas.

### Compartible en todas partes

**Badge embebible** para READMEs (SVG cacheado, se actualiza cada hora), **explorer instantáneo** `/r/owner/name` para cualquier repo sin instalar nada, y **tarjetas Open Graph dinámicas** con las stats en vivo en cada link compartido.

## API, MCP y CLI

La misma telemetría, expuesta de tres formas para devs y agentes. Todo **público, gratis y solo-caché** (nunca llama a GitHub por petición). El histórico per-repo es el producto hosted aparte.

**REST `/api/v1`** — endpoints `repo`, `leaderboard`, `velocity`, `overtakes`, `compare`, `embed`, con índice autodescriptivo en `/api/v1`. Usa el `owner/name` canónico (p.ej. `react/react`). `leaderboard` y `velocity` aceptan `?language=`; `overtakes?repo=` da quién caza ese repo.

```bash
curl "https://warpchart.dev/api/v1/leaderboard?language=Rust"
curl "https://warpchart.dev/api/v1/overtakes?repo=d3/d3"   # quién está cazando a d3/d3
```

**MCP `/api/mcp`** — servidor MCP (streamable HTTP) para que tu agente consulte el ranking. Tools: `get_repo_stats`, `get_leaderboard`, `get_velocity_rankings`, `get_active_overtakes` (con `repo` = quién lo caza), `compare_repos`, `get_embed_snippet`. Añádelo a Claude Desktop / Cursor:

```json
{ "mcpServers": { "warpchart": { "url": "https://warpchart.dev/api/mcp" } } }
```

**CLI** — `npx warpchart owner/name` (carta braille + quién te caza), `npx warpchart hunters owner/name`, `top --lang Rust`, `velocity --lang Go`, `compare a/b c/d`, `embed owner/name`, `--json`. Código en [`cli/`](cli/).

## Setup en 5 minutos

1. Usa este repositorio como plantilla.
2. Edita `mission.config.json` con tu `owner/name`.
3. Ejecuta el workflow `bootstrap` desde la pestaña Actions (o en local con `GH_TOKEN=$(gh auth token) node collector/bootstrap.mjs` y commitea `data/`).
4. Importa el repo en Vercel y añade la variable `GITHUB_TOKEN` (PAT fine-grained de solo lectura de repos públicos).
5. Listo. El workflow horario `collect` mantiene el histórico y redespliega solo.

Sin base de datos, sin APIs de pago, sin secrets para el collector.

### El vigilante

Un producto de telemetría vale lo que vale la confianza que puedes depositar en él, y el fallo que importa no es que se caiga: es que enseñe con total seguridad un número que dejó de ser cierto. Por eso `collector/health.mjs` se ejecuta cada dos horas contra producción y comprueba lo que si no habría que acordarse de mirar a mano: que los datos sean recientes de verdad, que los números sean siquiera posibles (nada gana ni pierde un 5% de sus estrellas al día como crecimiento), que las fuentes externas sigan respondiendo lo mismo que la última vez, que los endpoints que toca un visitante sigan funcionando para repos que no son tuyos, y que un mismo repo muestre la misma velocidad en todas las superficies.

Cada hallazgo lleva un remedio, no solo una alarma, y aterriza en un único issue de GitHub que se actualiza solo y se cierra cuando todo vuelve a estar bien. Puedes ejecutarlo contra cualquier instancia:

```bash
node collector/health.mjs --base=https://tu-instancia.vercel.app --no-fail
```

## Licencia

MIT

## Let's Connect

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hola@santifer.io)
