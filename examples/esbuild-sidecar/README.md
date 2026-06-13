# Pointcut — esbuild + standalone Sidecar demo

A **dev-server-less** demo (ADR-0002). esbuild only bundles and serves static
files — it has no middleware hook to mount the Bridge on. So this example proves
the **Sidecar** path, the universal runtime for setups without a dev server:

- The Pointcut **esbuild plugin** does the two transform-side jobs (Source Stamp
  + Bridge base-URL stamp) at build time, and `bridge.port` tells the client to
  reach the Bridge cross-origin at `http://localhost:7321`.
- The **Bridge** runs in a *separate process* via `npx pointcut-sidecar`.
- The Sidecar is **CORS-locked to localhost**, so only this loopback page can
  talk to it; it answers the client's `OPTIONS` preflight so the cross-origin
  POST to the agent-run endpoint goes through.

The mounted handler is the **same** `createBridge()` the dev-server auto-attach
uses — the Sidecar is a peer, not a fallback (no behavioral divergence).

## How it works

`build.mjs` runs esbuild with the Pointcut plugin:

```js
pointcut({ framework: 'jsx', inject: false, bridge: { port: 7321 } })
```

- `framework: 'jsx'` stamps `data-pointcut-loc="file:line:col"` onto every
  lowercase host tag in `src/App.jsx`. `enforce: 'pre'` makes the stamp run
  **before** esbuild lowers JSX, so the loc matches the real source.
- `bridge: { port: 7321 }` replaces the client's `__POINTCUT_BRIDGE__`
  placeholder with `"http://localhost:7321"` (vs. the empty same-origin string
  auto-attach uses).
- `inject: false` because esbuild has no `transformIndexHtml`; `src/main.jsx`
  imports `@pointcut/core/client` itself.

## Run it (two processes)

```bash
# Node 24 via nvm
source ~/.nvm/nvm.sh && nvm use 24

# Build everything once (so the workspace dist/ exists)
pnpm -w build

# Terminal 1 — the Bridge (Sidecar), CORS-locked to localhost on :7321
pnpm --filter @pointcut/example-esbuild-sidecar sidecar
#   (or: POINTCUT_PORT=7321 npx pointcut-sidecar)

# Terminal 2 — esbuild watch + static server on :5180
pnpm --filter @pointcut/example-esbuild-sidecar dev
```

Open the printed `http://localhost:5180/`.

## Manual verification (AC #4)

1. Both processes running as above.
2. **pick → jump-to-source**: click **pick** (bottom-right), then click the
   "Primary action" button. The client `GET`s `http://localhost:7321/__pointcut/open?...`
   cross-origin and your editor opens at the button's exact line in
   `src/App.jsx`. (View `dist/main.js` to confirm each host tag carries
   `data-pointcut-loc`, and that `bridgeBase` is `"http://localhost:7321"`.)
3. **send-to-Agent**: in the Send panel, pick an installed agent + mode and
   click **Send to agent**. The client `POST`s the annotation to
   `http://localhost:7321/__pointcut/agent` cross-origin (preceded by an
   `OPTIONS` preflight the Sidecar answers) and streams back the NDJSON Actions.

If the agent picker is empty, no agent CLI is installed on PATH — jump-to-source
still works; install an agent CLI (claude / codex / cursor) to exercise send.
