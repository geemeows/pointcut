---
"@pointcut/sidecar": minor
---

Initial release of the standalone Bridge server.

- **`startSidecar()`** mounts the same `createBridge()` handler from `@pointcut/core`
  on a bare Node HTTP server — a peer to the unplugin's auto-attach, not a fallback,
  so the two paths can't diverge in behavior.
- **`pointcut-sidecar` CLI** (`npx pointcut-sidecar`): the universal runtime for
  bundlers with no dev-server middleware hook (standalone esbuild / Rollup / Rolldown
  / Farm). Port resolution is most-specific-first: `--port <n>` flag, then
  `POINTCUT_PORT`, then the default (`7321`), matching the `bridge.port` the unplugin
  stamps into the client.
- **CORS-locked to localhost**: only ever reflects a `localhost` / `127.0.0.1` origin,
  since the in-page client reaches it cross-origin.
