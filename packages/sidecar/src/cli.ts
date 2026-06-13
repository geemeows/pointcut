#!/usr/bin/env node
// `npx pointcut-sidecar` — launch the standalone Bridge.
//
// Port resolution, most-specific first: a `--port <n>` CLI flag, then the
// POINTCUT_PORT env var, then DEFAULT_PORT. The flag and env must match the
// `bridge.port` the unplugin stamped into the client, so the cross-origin base
// URL points back here (ADR-0002).
import { startSidecar, DEFAULT_PORT } from './index';

/** Read `--port <n>` / `--port=<n>` from argv; undefined if absent or invalid. */
function portFromArgv(argv: string[]): number | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--port') {
      const n = Number(argv[i + 1]);
      return Number.isFinite(n) ? n : undefined;
    }
    if (arg.startsWith('--port=')) {
      const n = Number(arg.slice('--port='.length));
      return Number.isFinite(n) ? n : undefined;
    }
  }
  return undefined;
}

const port = portFromArgv(process.argv.slice(2)) ?? Number(process.env.POINTCUT_PORT ?? DEFAULT_PORT);
startSidecar({ port });
// eslint-disable-next-line no-console
console.log(`[pointcut] sidecar listening on http://localhost:${port}`);
