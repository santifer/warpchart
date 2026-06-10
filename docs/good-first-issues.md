# Good first issues (drafts)

Ready to be opened as GitHub issues when the repo goes public. Each one is
self-contained and labeled by area.

## 1. Replay export as GIF or video
`area: replay` · `good first issue`
The replay (Cumulative panel) animates the whole journey in ~36s. Add an
export button that captures it as a shareable GIF/WebM (canvas capture or
MediaRecorder over an offscreen render). Keep the HUD styling.

## 2. Touch support for panning the star chart
`area: star chart` · `good first issue`
The local-system window pans with horizontal wheel and zooms with ctrl+wheel.
On touch devices neither exists. Add one-finger horizontal drag to pan and
pinch to zoom on the SVG (pointer events, no library).

## 3. Accent themes
`area: theming` · `good first issue`
`mission.config.json` already has an `accent` field that is not honored yet.
Wire it: map a small set of named accents (cyan, amber, green, magenta) to the
CSS custom properties in `globals.css` and to `src/lib/theme.ts`.

## 4. Sound presets
`area: sound` · `good first issue`
The synthesized soundscape (`src/lib/sound.ts`) has fixed parameters. Add 2-3
presets (calm / standard / busy) selectable next to the SOUND toggle,
persisted in localStorage.

## 5. Compare overlay for a pinned target
`area: charts`
When a chase target is pinned, overlay its estimated cumulative trajectory on
the Cumulative chart (straight line from current stars at its measured
velocity) so the crossing point is visible.

## 6. i18n of the UI copy
`area: ui`
All copy is English and lives inline. Extract to a small dictionary and add
Spanish. No framework needed, a typed object and a config flag is enough.

## 7. Weekly digest issue
`area: collector`
A scheduled workflow that opens (or updates) a GitHub issue in the tracked
repo once a week with the mission log of the week: stars gained, rank moves,
overtakes, records. Plain Node like the other collectors.
