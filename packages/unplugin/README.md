# @pointcut/unplugin

The universal build-time plugin for [Pointcut](https://github.com/geemeows/pointcut) — a
dev-only, design-mode-gated in-browser toolbar where you **point** at a live DOM element and
the intended change is **cut** into source by an AI coding agent.

This package does two genuinely bundler-agnostic jobs on the transform side, plus a thin
per-dev-server auto-attach:

1. **Source Stamp** — writes `data-pointcut-loc="file:line:col"` onto every opening element
   tag (via a pluggable per-framework stamper: Vue SFC, JSX/TSX, Svelte, plain HTML), so a
   clicked DOM node resolves back to its exact spot in source.
2. **Inject** — auto-prepends `import '@pointcut/core/client'` into the entry (opt out with
   `inject: false` and import it yourself).
3. **Auto-attach** — where a dev server exists (Vite / Webpack / Rspack), mounts the
   [Bridge](https://github.com/geemeows/pointcut) so toolbar intent becomes agent edits. For
   bundlers without a dev-server hook (standalone esbuild / Rollup / Rolldown / Farm), pair
   this with [`@pointcut/sidecar`](https://www.npmjs.com/package/@pointcut/sidecar).

> Pointcut is **dev-only**. The plugin carries a hard guard (`apply: 'serve'`) and is inert
> unless you explicitly opt it into your config behind your own dev condition. It never ships
> to production.

## Install

```bash
npm install -D @pointcut/unplugin
# or
pnpm add -D @pointcut/unplugin
```

## Quick start (Vite)

Import the plugin from the subpath matching your bundler and gate it behind a dev flag:

```js
// vite.config.js
import { defineConfig } from 'vite';
import pointcut from '@pointcut/unplugin/vite';

export default defineConfig({
  plugins: [
    // Only active when you opt in — e.g. `DESIGN=1 vite`.
    process.env.DESIGN ? pointcut({ framework: 'auto' }) : null,
  ],
});
```

## Bundler entry points

Import from the subpath for your bundler:

```js
import pointcut from '@pointcut/unplugin/vite';
import pointcut from '@pointcut/unplugin/webpack';
import pointcut from '@pointcut/unplugin/rspack';
import pointcut from '@pointcut/unplugin/esbuild';
import pointcut from '@pointcut/unplugin/rollup';
import pointcut from '@pointcut/unplugin/farm';
```

## Options

```ts
pointcut({
  framework: 'auto',          // 'auto' | 'vue' | 'jsx' | 'svelte' | 'html'
  inject: true,               // auto-inject the client; false to import it yourself
  agents: 'auto',             // agent allow-list, or 'auto' for every CLI on PATH
  bridge: { port: 7321 },     // stamped into the client as its Bridge base URL
  tokens: { /* … */ },        // optional design-token grouping hints (zero-config works)
});
```

For setups with no dev-server middleware hook (standalone esbuild / Rollup / Rolldown / Farm),
set `inject: false`, point `bridge.port` at your sidecar, and run
[`npx pointcut-sidecar`](https://www.npmjs.com/package/@pointcut/sidecar) alongside the build.

See the [main README](https://github.com/geemeows/pointcut#readme) for full per-bundler
examples and architecture.

## License

[MIT](./LICENSE)
