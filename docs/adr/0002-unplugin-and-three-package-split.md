# One unplugin + a `core`/`sidecar` split, not per-bundler adapter packages

Pointcut targets many bundlers (Vite, Rollup, Rolldown, Webpack, Rspack, esbuild, Farm,
Parcel). We build the transform/inject side on **`unplugin`** (one plugin → all bundlers)
and keep all bundler-free logic in **`@pointcut/core`**, rather than shipping a hand-rolled
adapter package per bundler.

## Considered Options

- **Per-bundler adapter packages** (`@pointcut/vite`, `@pointcut/webpack`, …) as the source
  handoff suggested. Doubles the surface for every new bundler and duplicates the transform.
  Rejected for the transform side.
- **unplugin + core + sidecar (chosen).**

## Decision

Three packages:

- **`@pointcut/core`** — bundler-free *and* framework-free: the vanilla client, the models,
  the drivers + registry, and the Bridge guts as a plain factory `createBridge()` returning
  a connect-style handler. The design-mode hard guard lives here, so every consumer inherits
  it.
- **`@pointcut/unplugin`** — the universal transform (pluggable Source Stamp) + inject
  (auto-inject `import '@pointcut/client'` into the entry, `inject:false` escape hatch). It
  *also* contains the thin per-dev-server **auto-attach** glue that mounts `createBridge()`
  (Vite `configureServer`, Webpack/Rspack `setupMiddlewares`).
- **`@pointcut/sidecar`** — a standalone Node server mounting the same `createBridge()`
  handler for dev-server-less setups (standalone Rollup/Rolldown/esbuild) and as a
  bundler-free test/debug harness.

The two coupling points get different strategies on purpose: the **transform** side is
genuinely shared (unplugin earns its keep), while the **Bridge** side is per-dev-server no
matter what — so its guts live in `core` and only a tiny mount adapter is per-bundler.

## Consequences

- Adding a bundler is usually free (unplugin) for transform/inject; only the auto-attach
  glue may need a few lines, and the sidecar always covers the gap.
- There is exactly one Bridge implementation, independently testable via the sidecar with no
  bundler in the loop.
- unplugin does **not** abstract HTML injection or the dev server uniformly; we accept a
  small honest per-bundler seam for those rather than pretending it's free.
