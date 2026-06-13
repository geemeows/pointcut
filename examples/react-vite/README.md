# Pointcut — React + Vite tracer bullet

A minimal React + Vite app wired to the Pointcut unplugin so you can pick a
rendered element and jump to its exact source line. It mirrors `examples/vue-vite`,
but uses the JSX/TSX Source Stamp instead of the Vue SFC one.

## How it works

`vite.config.js` opts Pointcut in behind a `DESIGN` env flag (lock #1); the
plugin's `apply: 'serve'` refuses to run in a production build (lock #2). The
unplugin's `enforce: 'pre'` runs the JSX Source Stamp **before** `@vitejs/plugin-react`'s
JSX transform, so `data-pointcut-loc="file:line:col"` is computed from the real
source positions and survives onto the emitted DOM. Lowercase host elements
(`<main>`, `<button>`, ...) are stamped; the `<Card>` component usage is skipped,
so a click on its rendered output resolves to the nearest stamped host inside it.

## Run it

```bash
# Node 24 via nvm
source ~/.nvm/nvm.sh && nvm use 24

# from the repo root
DESIGN=1 pnpm --filter @pointcut/example-react-vite dev
```

Then open the printed `http://localhost:5173/` URL.

## Manual verification (AC #5)

1. Start the dev server with `DESIGN=1` as above.
2. View source of `http://localhost:5173/src/App.jsx` (the transformed module).
   Each lowercase host element carries a `data-pointcut-loc` prop, e.g. the
   `<main className="page">` on line 12 of `src/App.jsx` becomes
   `"data-pointcut-loc": "src/App.jsx:12:5"`. The `<Card>` / `<App>` /
   `<StrictMode>` components carry **no** such prop.
3. In the running page, use the Pointcut toolbar's **pick** (bottom-right) and
   click any visible element (e.g. the "Primary action" button). Your editor
   opens at that element's exact line:col in `src/App.jsx`.
4. Click an element rendered by `<Card>` (the "A card" heading): the pick
   resolves to the nearest stamped host (the `<section>` inside `Card`), i.e.
   line 7 — the component's usage site, not its internals.
