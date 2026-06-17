# Pointcut

A dev-only, design-mode-gated in-browser design toolbar. You **point** at a live DOM
element and the intended change is **cut** into source by an AI coding agent.
Framework-agnostic (vanilla client) and bundler-agnostic (one `unplugin` plugin + a
standalone sidecar).

Pointcut injects a floating toolbar into your app **during local dev only**. You pick a
real element on the page (or marquee a region), annotate what you want changed, and hand
the accumulated picks to an installed agent CLI (Claude / Codex / Cursor). The agent edits
your actual source files; the toolbar streams its progress back into the page. The source
location of every clicked element is also clickable — it opens the exact file:line in your
editor.

It is a clean-room standalone tool: it carries **no** vocabulary, tokens, or component
knowledge from any specific design system. Everything design-system-specific is
introspected from your running app (live CSSOM + source stamps) at runtime.

See [`CONTEXT.md`](./CONTEXT.md) for the glossary and [`docs/adr/`](./docs/adr) for the
architectural decisions.

---

## Table of contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Packages](#packages)
- [Install](#install)
- [Quick start (Vite)](#quick-start-vite)
- [Setup by bundler](#setup-by-bundler)
  - [Vite](#vite)
  - [Webpack](#webpack)
  - [Rspack](#rspack)
  - [esbuild + Sidecar](#esbuild--sidecar)
  - [Rollup / Rolldown / Farm](#rollup--rolldown--farm)
- [Plugin options](#plugin-options)
- [The two design-mode locks](#the-two-design-mode-locks)
- [Using the toolbar](#using-the-toolbar)
- [Agents (Drivers)](#agents-drivers)
- [The Bridge endpoints](#the-bridge-endpoints)
- [Bundle size](#bundle-size)
- [Troubleshooting](#troubleshooting)
- [Develop](#develop)

---

## How it works

A Pointcut install has two coupling points with your build, both handled by the one
plugin:

1. **Source Stamp** (compile-time transform). The plugin writes a
   `data-pointcut-loc="file:line:col"` attribute onto every opening element tag, so a
   clicked DOM node can be resolved back to its exact spot in source. It is pluggable per
   framework: Vue SFC, JSX/TSX, Svelte, and plain HTML.
2. **The Bridge** (dev-server runtime). Three endpoints under a neutral `/__pointcut/*`
   prefix: open-in-editor, agent-probe (which agents are installed), and agent-run (spawn
   the chosen agent CLI and stream its events back as a uniform NDJSON `Action` stream).

Where a dev server exists (Vite / Webpack / Rspack), the plugin **auto-attaches** the
Bridge onto it — no extra wiring. Where there is no dev-server middleware hook (standalone
esbuild / Rollup / Rolldown / Farm), you run the **Sidecar** (`npx pointcut-sidecar`) as a
separate process and the in-page client reaches it cross-origin.

```
 ┌─ your browser ────────────────┐        ┌─ your machine ─────────────┐
 │  app + injected toolbar       │        │  Bridge (dev server         │
 │  • Pick / marquee elements    │ ─────▶ │   middleware or sidecar)    │
 │  • Queue annotations          │  /__   │  • open file in editor      │
 │  • Send to agent              │ point  │  • probe installed agents   │
 │  • Stream Actions back ◀──────┼─ cut/* │  • spawn agent CLI ─▶ edits │
 └───────────────────────────────┘        └────────────────────────────┘
```

---

## Requirements

- **Node** `>= 18` for the published packages (this repo itself pins **Node 24** for
  development via `.nvmrc`).
- A supported bundler: Vite, Webpack, Rspack, esbuild, Rollup, Rolldown, or Farm.
- For the agent step: at least one agent CLI installed and on your `PATH`
  (`claude`, `codex`, or `cursor`). Jump-to-source and picking work without any agent.

---

## Packages

| Package | Role |
|---|---|
| [`@pointcut/core`](./packages/core) | Bundler-free, framework-free: the in-page client, authoring models, agent Drivers, and the Bridge (`createBridge()`). Owns the design-mode hard guard. |
| [`@pointcut/unplugin`](./packages/unplugin) | Universal Source Stamp + client inject + dev-server auto-attach, across all bundlers via [unplugin](https://github.com/unjs/unplugin). **This is the package you install in most setups.** |
| [`@pointcut/sidecar`](./packages/sidecar) | Standalone Bridge server (`npx pointcut-sidecar`) for setups without a dev-server middleware hook (standalone esbuild / Rollup / Rolldown / Farm). |

`@pointcut/unplugin` depends on `@pointcut/core`, so installing the unplugin pulls the
client in transitively — you don't normally install `@pointcut/core` yourself.

---

## Install

Install the plugin as a **dev dependency** — Pointcut never ships to production.

```sh
# npm
npm install -D @pointcut/unplugin

# pnpm
pnpm add -D @pointcut/unplugin

# yarn
yarn add -D @pointcut/unplugin
```

For the dev-server-less path (standalone esbuild / Rollup / Rolldown / Farm), also add the
sidecar:

```sh
pnpm add -D @pointcut/sidecar
```

---

## Quick start (Vite)

```js
// vite.config.js
import { defineConfig } from 'vite';
import pointcut from '@pointcut/unplugin/vite';

export default defineConfig({
  plugins: [
    // Opt in behind your own dev condition (lock #1). The plugin also hard-guards
    // against production builds (lock #2), so this can never ship.
    process.env.DESIGN ? pointcut({ framework: 'auto' }) : null,
  ].filter(Boolean),
});
```

Then start dev with the flag set:

```sh
DESIGN=1 npm run dev
```

Open the app — a floating toolbar appears. With `DESIGN` unset, the plugin isn't even in
the array and your dev server is exactly as it was.

---

## Setup by bundler

Import the plugin from the subpath matching your bundler:

```js
import pointcut from '@pointcut/unplugin/vite'    // or:
//                                  /webpack
//                                  /rspack
//                                  /esbuild
//                                  /rollup
//                                  /farm
```

### Vite

The common path. The plugin auto-attaches the Bridge via `configureServer`, injects the
client via `transformIndexHtml`, and its `apply: 'serve'` guard keeps it inert in
production builds. Put it **before** your framework plugin so the Source Stamp runs before
the framework compiler turns templates/JSX into render code.

```js
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pointcut from '@pointcut/unplugin/vite';

export default defineConfig({
  plugins: [
    process.env.DESIGN ? pointcut({ framework: 'jsx' }) : null,
    react(),
  ].filter(Boolean),
});
```

Swap `framework` to match your stack: `'vue'`, `'jsx'`, `'svelte'`, `'html'`, or `'auto'`.

### Webpack

Same one-plugin install. The plugin's `webpack(compiler)` hook mounts the Bridge onto
`devServer.setupMiddlewares` (wrapping any you already define) and surfaces the Bridge base
URL via webpack's `DefinePlugin`. The production guard refuses to attach when
`mode === 'production'`.

```js
// webpack.config.js
import webpack from 'webpack';
import pointcut from '@pointcut/unplugin/webpack';

export default {
  // ...your entry, loaders, etc.
  plugins: [
    // ...your other plugins
    process.env.DESIGN && pointcut({ framework: 'vue' }),
  ].filter(Boolean),
  devServer: {
    hot: true,
    // The Bridge adds its own /__pointcut/* middleware on top of whatever you configure
    // here — it wraps your setupMiddlewares instead of clobbering it.
  },
};
```

Run with `DESIGN=1 webpack serve --mode development`.

### Rspack

Identical contract to Webpack (drop-in compatible compiler, same `setupMiddlewares` hook
and `DefinePlugin`):

```js
import pointcut from '@pointcut/unplugin/rspack';
// ...same shape as the Webpack config above
```

### esbuild + Sidecar

Standalone esbuild only bundles and serves static files — there's no dev-server middleware
hook, so the Bridge runs in a **separate process** via the sidecar. The esbuild plugin
stamps source and stamps the client's Bridge base URL at your sidecar's port; set
`inject: false` and import the client yourself (esbuild has no `transformIndexHtml`).

```js
// build.mjs
import esbuild from 'esbuild';
import pointcut from '@pointcut/unplugin/esbuild';

const SIDECAR_PORT = Number(process.env.POINTCUT_PORT ?? 7321);

const ctx = await esbuild.context({
  entryPoints: ['src/main.jsx'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/main.js',
  plugins: [
    pointcut({
      framework: 'jsx',
      inject: false,                  // import the client yourself (see below)
      bridge: { port: SIDECAR_PORT }, // cross-origin base URL stamped into the client
    }),
  ],
});

await ctx.watch();
await ctx.serve({ servedir: 'dist', port: 5180 });
```

Import the client once in your entry (only when designing):

```js
// src/main.jsx
if (process.env.DESIGN) {
  await import('@pointcut/core/client');
}
```

Run the app build/watch in one terminal and the sidecar in another:

```sh
# terminal 1 — app
DESIGN=1 node build.mjs --watch

# terminal 2 — Bridge sidecar (must match bridge.port above)
POINTCUT_PORT=7321 npx pointcut-sidecar
```

The sidecar is CORS-locked to `localhost`/`127.0.0.1`, so only your loopback page can talk
to it.

### Rollup / Rolldown / Farm

Same as esbuild: stamp via `@pointcut/unplugin/rollup` (or `/farm`) with
`inject: false` + `bridge.port`, and run `npx pointcut-sidecar` alongside.

---

## Plugin options

```ts
pointcut({
  framework: 'auto',          // 'auto' | 'vue' | 'jsx' | 'svelte' | 'html'
  inject: true,               // auto-inject the client into the page; false = import it yourself
  agents: 'auto',             // 'auto' (every installed CLI on PATH) | string[] allow-list
  bridge: { port: 7321 },     // sidecar port — stamped into the client as its base URL
  tokens: { /* hints */ },    // optional design-token grouping hints; refinement only
})
```

| Option | Type | Default | What it does |
|---|---|---|---|
| `framework` | `'auto' \| 'vue' \| 'jsx' \| 'svelte' \| 'html'` | `'auto'` | Which Source Stamper(s) to run. `'auto'` enables all and lets each self-gate by file extension (`.vue` → Vue, `.jsx`/`.tsx` → JSX, `.svelte` → Svelte, `.html` → HTML). |
| `inject` | `boolean` | `true` | Auto-inject `@pointcut/core/client` into the served page. Set `false` to import it yourself (required for esbuild/Rollup/Farm, which have no HTML-inject hook). |
| `agents` | `'auto' \| string[]` | `'auto'` | `'auto'` offers every supported agent CLI found on `PATH`. An explicit array is an allow-list, e.g. `['claude']`. |
| `bridge.port` | `number` | _(unset)_ | Presence means the **sidecar** path: the client is stamped to reach `http://localhost:<port>` cross-origin. Omit it on the auto-attach path (same-origin). |
| `tokens` | `Record<string, string>` | _(unset)_ | Optional grouping hints for design tokens. Pure refinement — zero-config works because tokens are introspected from the live CSSOM. |

---

## The two design-mode locks

Pointcut is gated by **two independent locks**, and both must be satisfied for it to run:

1. **Your lock.** You opt the plugin into your config behind your own dev condition (the
   examples use `process.env.DESIGN`). If you don't add it, it isn't there.
2. **The plugin's lock.** Even if you add it, the plugin hard-guards against production
   builds — Vite via `apply: 'serve'`, Webpack/Rspack by refusing to attach when
   `mode === 'production'`. The Bridge itself is a no-op passthrough unless explicitly
   enabled.

The net effect: **Design Mode never ships to production.** This is why the realistic
production bundle cost is effectively zero (see [Bundle size](#bundle-size)).

---

## Using the toolbar

Once the toolbar is injected (dev only), the flow is:

1. **Pick.** Enter Pick mode; hover highlights elements, a click locks one. Or drag a
   marquee to annotate a whole region.
2. **Annotate.** Each pick becomes a numbered **Annotation** with a type tag and a
   jump-to-source link. Annotations accumulate in a **Queue/Session** persisted to
   `localStorage`, with numbered bubbles pinned to the annotated spots.
3. **Review.** A non-modal side panel holds two tabs — **Comments** (the Queue) and
   **Chat** (a continuous discuss session). It toggles from the toolbar; clicking the page
   leaves it open.
4. **Hand off.** Either:
   - **Export** — download a paste-and-go markdown **Handoff** you can drop into any agent, or
   - **Send to agent** — stream the chosen agent's edits back into the page live.
5. **Jump to source.** Any annotation's source `loc` is clickable and opens that exact
   `file:line:col` in your editor.

The toolbar renders into a **shadow root**, so its styles are isolated from your app both
ways and the host element is excluded from Pick mode.

---

## Agents (Drivers)

The agent step uses an installed CLI. A **Driver** is a per-agent module that knows one
CLI's recipe — how to build its args and how to translate its native events into the
uniform `Action` stream. Three ship today:

| Agent | CLI on `PATH` |
|---|---|
| Claude | `claude` |
| Codex | `codex` |
| Cursor | `cursor` (models discovered live) |

Each run has a **mode** that sets the Driver's permission posture:

- `apply` — let the agent apply edits.
- `apply-once` — apply a single round of edits.
- `discuss` — talk it through without applying.

Adding a new agent is one Driver module plus one registry entry — the Bridge, the wire
protocol, and the client never change.

---

## The Bridge endpoints

The Bridge is a single connect-style handler mountable on any Node HTTP server. It serves
three endpoints under the neutral `/__pointcut/*` prefix:

| Endpoint | Purpose |
|---|---|
| `/__pointcut/open` | Open a clicked element's `file:line:col` in your editor (via `launch-editor`). |
| `/__pointcut/agents` | Probe which agent CLIs are installed/allowed. |
| `/__pointcut/agent` | Spawn the chosen agent and stream a uniform NDJSON `Action` stream: `{t:'action',a}` \| `{t:'error',m}` \| `{t:'end',code}`. |

You normally never touch these directly — the toolbar talks to them. If you need to mount
the Bridge manually (custom server), `@pointcut/core` exposes `createBridge()`:

```js
import { createBridge } from '@pointcut/core';

const handler = createBridge({
  enabled: true,         // hard guard: a no-op passthrough when false
  cwd: process.cwd(),    // project root the agent CLI runs in / locs resolve against
  agents: ['claude'],    // optional allow-list; omit for every Driver on PATH
});
// mount `handler` as connect-style middleware: (req, res, next) => void
```

The sidecar (`startSidecar({ port, cwd })`, default port **7321**) mounts this exact same
handler on a bare HTTP server.

---

## Bundle size

- **Production: ~0 KB.** Design Mode is fail-closed and stripped from production builds, so
  Pointcut adds nothing to your users' shipped bundle.
- **Dev only:** the injected in-page client is roughly **~30 KB gzipped** (minified). This
  is the only runtime code that ever reaches the browser, and it only does so while you're
  actively designing.

The `unplugin` and `sidecar` packages run in Node at build/dev time and never reach the
browser at all.

---

## Troubleshooting

- **Toolbar doesn't appear.** Confirm your dev condition is set (e.g. `DESIGN=1`) *and*
  you're running the dev server (`vite`, `webpack serve`), not a production build. Both
  locks must be open.
- **`Failed to resolve import '@pointcut/core/client'`.** On Vite this is handled for you
  (the client is served by absolute `/@fs/` path). If you set `inject: false`, make sure
  you import the client yourself in your entry.
- **No agents listed in the toolbar.** The agent step needs a CLI (`claude`, `codex`, or
  `cursor`) installed and on the `PATH` of the process running the dev server / sidecar.
  Picking and jump-to-source work without any agent.
- **esbuild/Rollup/Farm: client can't reach the Bridge.** The sidecar must be running and
  its port must match the `bridge.port` you stamped. Start it with
  `POINTCUT_PORT=<port> npx pointcut-sidecar`.
- **Source `loc` opens the wrong line.** The Source Stamp must run *before* your framework
  compiler — keep `pointcut(...)` ahead of the framework plugin (Vite) and rely on the
  plugin's `enforce: 'pre'` (Webpack/Rspack PRE-loader) which is set automatically.

---

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

Runnable demos live in [`examples/`](./examples) — one per bundler/framework
(`react-vite`, `vue-vite`, `svelte-vite`, `html`, `vue-webpack`, `esbuild-sidecar`). Each
enables design mode with `DESIGN=1`, e.g.:

```sh
DESIGN=1 pnpm --filter @pointcut/example-react-vite dev
```
