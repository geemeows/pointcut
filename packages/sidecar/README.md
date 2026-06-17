# @pointcut/sidecar

The standalone Bridge server for [Pointcut](https://github.com/geemeows/pointcut) — a dev-only,
design-mode-gated in-browser toolbar where you **point** at a live DOM element and the intended
change is **cut** into source by an AI coding agent.

The sidecar mounts the **same** `createBridge()` handler from
[`@pointcut/core`](https://www.npmjs.com/package/@pointcut/core) on a bare Node HTTP server. It
is the universal runtime for bundlers with no dev-server middleware hook (standalone esbuild /
Rollup / Rolldown / Farm), and a **peer** to the unplugin's auto-attach path — same handler, so
the two can't diverge in behavior. It is CORS-locked to `localhost` because the in-page client
reaches it cross-origin.

## Install

```bash
npm install -D @pointcut/sidecar
# or
pnpm add -D @pointcut/sidecar
```

## Usage (CLI)

Run it alongside your build. Pair it with
[`@pointcut/unplugin`](https://www.npmjs.com/package/@pointcut/unplugin) configured with
`inject: false` and `bridge.port` pointed at the same port:

```bash
npx pointcut-sidecar --port 7321
```

Port resolution, most-specific first: the `--port <n>` flag, then the `POINTCUT_PORT` env var,
then the default (`7321`). The port must match the `bridge.port` the unplugin stamped into the
client, so the client's cross-origin base URL points back here.

## Usage (programmatic)

```js
import { startSidecar, DEFAULT_PORT } from '@pointcut/sidecar';

const server = startSidecar({
  port: DEFAULT_PORT, // default 7321
  cwd: process.cwd(), // project root the agent CLI runs in
});
```

See the [main README](https://github.com/geemeows/pointcut#readme) for a full esbuild + sidecar
example and architecture.

## License

[MIT](./LICENSE)
