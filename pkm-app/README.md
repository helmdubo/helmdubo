# PKM App

Personal knowledge management app: notes + tags + links/graph + tasks.

Web/PWA first, built with Vite + React + TypeScript, storing data locally in
the browser via SQLite WASM + OPFS. No backend, no sync, no server-side code
in M0–M4. See `docs/pkm/orchestrator-brief-v3.md` (repo root) for the full
architecture brief.

## Browser-run contract

This app must run from the browser through Vite. The dev container (if any)
only hosts Node/Vite — application data does **not** live in the container.

```sh
cd pkm-app
npm install
npm run dev -- --host 0.0.0.0
```

Open:

```
http://localhost:5173
```

Production preview must also work:

```sh
npm run build
npm run preview -- --host 0.0.0.0
```

## Where the data actually lives

SQLite/OPFS data is stored in the **browser's origin storage**, not on disk
in the dev container and not anywhere on the server. If you run this in a
container, the container is only responsible for running Node and serving
Vite's dev/build output — closing the browser tab or switching machines
means the data does not travel with you, because it lives in that browser
profile's OPFS bucket for `http://localhost:5173` (or wherever the app is
served from).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check and produce a production build |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Vitest unit tests |

## Project layout

```
pkm-app/
  src/        application source (storage, db, repositories, UI, dev harness)
  spike/      throwaway SQLite WASM + OPFS feasibility spike (see spike/FINDINGS.md)
```
