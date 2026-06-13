// @pointcut/sidecar — the standalone Bridge server (ADR-0002).
//
// Mounts the SAME createBridge() handler from @pointcut/core on a bare HTTP
// server. The universal runtime for bundlers with no dev-server middleware hook
// (standalone Rollup/Rolldown/esbuild), and a peer to auto-attach — same
// handler, so the two paths can't diverge in behavior. CORS-locked to localhost
// because the in-page client reaches it cross-origin (ADR: bridge discovery).
import { createServer, type Server } from 'node:http';
import { createBridge } from '@pointcut/core';

export interface SidecarOptions {
  /** Port the client's injected base URL points at. */
  port?: number;
  /** Project root the agent CLI runs in. */
  cwd?: string;
}

export const DEFAULT_PORT = 7321;

const isLocalOrigin = (origin: string | undefined): boolean =>
  !!origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

export function startSidecar(options: SidecarOptions = {}): Server {
  const port = options.port ?? DEFAULT_PORT;
  const handler = createBridge({ enabled: true, cwd: options.cwd ?? process.cwd() });

  const server = createServer((req, res) => {
    const origin = req.headers.origin;
    if (isLocalOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin as string);
      res.setHeader('Vary', 'Origin');
    }
    handler(req, res);
  });

  server.listen(port);
  return server;
}
