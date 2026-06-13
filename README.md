# Pointcut

A dev-only, design-mode-gated in-browser design toolbar. You **point** at a live DOM
element and the intended change is **cut** into source by an AI coding agent.
Framework-agnostic (vanilla client) and bundler-agnostic (one `unplugin` plugin + a
standalone sidecar).

See [`CONTEXT.md`](./CONTEXT.md) for the glossary and [`docs/adr/`](./docs/adr) for the
architectural decisions.

## Packages

| Package | Role |
|---|---|
| [`@pointcut/core`](./packages/core) | Bundler-free, framework-free: client, models, drivers, and the Bridge (`createBridge()`). Owns the design-mode hard guard. |
| [`@pointcut/unplugin`](./packages/unplugin) | Universal Source Stamp + inject + dev-server auto-attach, across all bundlers via [unplugin](https://github.com/unjs/unplugin). |
| [`@pointcut/sidecar`](./packages/sidecar) | Standalone Bridge server (`npx pointcut-sidecar`) for setups without a dev-server middleware hook. |

## Usage (target API)

```js
// vite.config.js — common path, one plugin
import pointcut from '@pointcut/unplugin/vite' // or /webpack, /rspack, /esbuild, /rollup, /farm

export default {
  plugins: [
    isDev && pointcut({ framework: 'auto' }), // gate behind your own dev flag
  ],
}
```

Design mode is gated by two independent locks: you opt the plugin in behind a dev
condition, **and** the plugin hard-guards against production builds.

## Develop

Requires Node `>=22`; this repo pins **Node 24** (`.nvmrc`) — run `nvm use`. pnpm `>=10`.
Tests run through `tsx` so ported `.mjs` and extensionless `.ts` both work; Node 24 also
runs `node --test` on `.ts` natively if we later adopt explicit `.ts` import extensions.

```sh
pnpm install
pnpm build       # tsup builds every package
pnpm typecheck   # tsc --noEmit per package
pnpm test        # node:test via tsx (ported .mjs suites run as-is)
```
