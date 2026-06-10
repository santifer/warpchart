# Mission Control

**[:gb: English](#the-problem)** | **[:es: Español](#es-versión-en-español)**

> A self-hosted growth telemetry dashboard for any GitHub repository. Point it at a repo and watch its journey to the top of the worldwide star ranking, like a star chart to the center of the galaxy.

## The Problem

If you maintain a fast-growing open source project, you end up asking the same questions every few hours: how fast are we growing right now? How does today compare to yesterday at this exact hour? What worldwide rank are we? Who are the repos right above us, how fast do they move, and when do we pass them?

GitHub gives you the raw data but no cockpit. Star-history charts are static. Trending is a black box. And nobody tracks the repos around you in the ranking.

## The Solution

Mission Control turns the public GitHub API into a live flight console:

- **Status bar**: stars, worldwide rank, stars in the last 60 minutes, today vs yesterday at the same hour, gap and ETA to the next rank milestone. Live, polling every minute.
- **Star chart**: a two-band space map. The local system shows your nearest ranking neighbors with their velocity and overtake ETAs. The route to the core shows every milestone between you and the worldwide #1 repository.
- **Velocity**: stars per hour for the last 24h with yesterday as a ghost line.
- **Daily ladder**: stars per day, 7-day average, and the night floor (00-05 UTC baseline) that tells compounding growth apart from a decaying spike.
- **Cumulative**: the honest chart, y axis from zero to your total.
- **Projections**: ETA to each milestone accounting for threshold drift (the bar to enter the top N rises every day).
- **Heatmap**: hour x weekday star activity since launch.
- **Rank over time**: built from hourly snapshots.

Everything derives from one config value: the repo you track. Branding (name, description, avatar) is fetched dynamically.

### How it works

```
GitHub Actions cron (hourly)              Vercel (Next.js)
  collector/collect.mjs                     static page built from data/
  snapshot -> data/history.jsonl            + live API routes (edge cached)
  commit -> push -> auto redeploy           polling from the browser
```

A one-time bootstrap walks the entire stargazer history (one timestamp per star), measures your worldwide rank, milestone thresholds and ranking neighbors, and commits the seed to `data/`. From then on an hourly GitHub Action appends snapshots and new timestamps. Every commit redeploys the site, so the static page is never more than an hour behind, and the live API routes cover the last hour from the browser.

No database. No paid APIs. No secrets to configure for the collector (it uses the automatic Actions token).

## Tech Stack

![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_v4-06B6D4?style=flat&logo=tailwindcss&logoColor=white)
![React](https://img.shields.io/badge/React_19-61DAFB?style=flat&logo=react&logoColor=black)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=flat&logo=githubactions&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat&logo=vercel&logoColor=white)

## Installation

1. Use this repository as a template (or fork it).
2. Edit `mission.config.json`:

```json
{
  "repo": "owner/name",
  "accent": "cyan"
}
```

3. Run the bootstrap (choose one):
   - **In GitHub**: Actions tab, run the `bootstrap` workflow, optionally passing the repo as input.
   - **Locally**: `GH_TOKEN=$(gh auth token) node collector/bootstrap.mjs`
     then commit `data/` and `mission.config.json`.
4. Deploy to Vercel: import the repo, add one environment variable:
   - `GITHUB_TOKEN`: a fine-grained personal access token with read-only access to public repositories (used by the live API routes).
5. Done. The hourly `collect` workflow keeps history growing and redeploys automatically.

## Usage

Open the page. The header and charts refresh on their own (60s for stars, rank and velocity, 5 min for neighbors). The API routes are edge-cached, so traffic does not consume your GitHub quota.

Local development:

```bash
npm install
GITHUB_TOKEN=$(gh auth token) npm run dev
```

## Configuration

| Key | What it does |
|---|---|
| `repo` | The repository to track, `owner/name`. The only required value. |
| `accent` | Reserved for theming. |

Generated data lives in `data/` and is owned by the collectors. Do not edit it by hand.

## License

MIT

---

# :es: Versión en Español

> Dashboard auto-alojado de telemetría de crecimiento para cualquier repositorio de GitHub. Apúntalo a un repo y observa su viaje hacia el top del ranking mundial de estrellas, como una carta estelar hacia el centro de la galaxia.

## El Problema

Si mantienes un proyecto open source que crece rápido, acabas haciéndote las mismas preguntas cada pocas horas: ¿a qué velocidad crecemos ahora mismo? ¿Cómo va hoy comparado con ayer a esta misma hora? ¿En qué puesto mundial estamos? ¿Quiénes son los repos justo por encima, a qué velocidad van y cuándo los adelantamos?

GitHub te da los datos en crudo pero no la cabina de mandos. Las gráficas de star-history son estáticas. Trending es una caja negra. Y nadie vigila a los repos que te rodean en el ranking.

## La Solución

Mission Control convierte la API pública de GitHub en una consola de vuelo en vivo:

- **Barra de estado**: stars, rank mundial, stars en los últimos 60 minutos, hoy contra ayer a la misma hora, distancia y ETA al siguiente hito de ranking. En vivo, refrescando cada minuto.
- **Carta estelar**: un mapa espacial de dos bandas. El sistema local muestra tus vecinos de ranking con su velocidad y ETA de adelantamiento. La ruta al núcleo muestra cada hito entre tú y el repositorio número 1 del mundo.
- **Velocidad**: stars por hora de las últimas 24h con ayer como línea fantasma.
- **Escalera diaria**: stars por día, media de 7 días y el suelo nocturno (baseline 00-05 UTC) que distingue el crecimiento compuesto de un pico que se apaga.
- **Acumulada**: la gráfica honesta, eje Y desde cero hasta tu total.
- **Proyecciones**: ETA a cada hito teniendo en cuenta el drift del umbral (el listón para entrar en el top N sube cada día).
- **Heatmap**: actividad de stars por hora y día de la semana desde el lanzamiento.
- **Rank en el tiempo**: construido con snapshots horarios.

Todo deriva de un solo valor de configuración: el repo que sigues. El branding (nombre, descripción, avatar) se obtiene dinámicamente.

### Cómo funciona

Un bootstrap inicial recorre todo el historial de stargazers (un timestamp por estrella), mide tu rank mundial, los umbrales de los hitos y tus vecinos de ranking, y commitea la semilla en `data/`. Desde entonces, una GitHub Action horaria añade snapshots y timestamps nuevos. Cada commit redespliega la web, así que la página estática nunca va más de una hora por detrás, y las rutas live cubren la última hora desde el navegador.

Sin base de datos. Sin APIs de pago. Sin secrets que configurar para el collector (usa el token automático de Actions).

## Instalación

1. Usa este repositorio como plantilla (o haz fork).
2. Edita `mission.config.json` con tu `owner/name`.
3. Ejecuta el bootstrap: workflow `bootstrap` en la pestaña Actions, o en local con `GH_TOKEN=$(gh auth token) node collector/bootstrap.mjs` y commitea `data/`.
4. Despliega en Vercel: importa el repo y añade la variable `GITHUB_TOKEN` (token fine-grained de solo lectura de repos públicos).
5. Listo. El workflow horario `collect` mantiene el histórico y redespliega solo.

## Licencia

MIT

## Let's Connect

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hola@santifer.io)
