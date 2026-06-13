# warpchart

Growth telemetry for any GitHub repository, in your terminal: worldwide rank, star velocity and a braille star-history chart. Public, cache-only data, no auth.

```bash
npx warpchart vuejs/core         # rank, velocity and a star chart
npx warpchart vuejs/core --json  # raw JSON (agent friendly)
npx warpchart velocity 15        # the fastest-growing repos right now
```

```
  ◤ WARPCHART  ·  vuejs/core
  RANK #397    STARS 53,821    ▲ 9.9/day

  ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣀⣀⡤⠤⠖⠒⠒⠉⠉⠉⠉
  ⠀⠀⠀⠀⠀⠀⢀⣀⣠⠤⠤⠖⠒⠋⠉⠉⠁⠈
  ⣀⡤⠴⠒⠋⠉⠁
  2018                                   now · 53,821★

  next gate top 300 · 7,816 ★ to go
  → https://warpchart.dev/r/vuejs/core
```

Data comes from the public Warpchart API (`https://warpchart.dev/api/v1`). Point the CLI elsewhere with `WARPCHART_BASE`. Per-repository historical telemetry is a separate hosted product at [warpchart.dev](https://warpchart.dev).

MIT.
