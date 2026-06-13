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
  // Byte-for-byte the SAME handler the unplugin auto-attaches (ADR-0002): the
  // Sidecar is a peer, not a degraded fallback, so the two paths can't diverge.
  const handler = createBridge({ enabled: true, cwd: options.cwd ?? process.cwd() });

  const server = createServer((req, res) => {
    const origin = req.headers.origin;
    if (isLocalOrigin(origin)) {
      // CORS: only ever reflect a localhost origin. A non-localhost origin gets
      // no Access-Control-Allow-Origin at all, so the browser blocks the read.
      res.setHeader('Access-Control-Allow-Origin', origin as string);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    // Preflight: the client's cross-origin POST to the agent-run endpoint
    // (Content-Type: application/json) triggers an OPTIONS preflight. Answer it
    // here — short-circuit before the Bridge, which only speaks GET/POST — so
    // the real request goes through. A non-localhost preflight gets a 403 with
    // no ACAO, so the browser never sends the actual request.
    if (req.method === 'OPTIONS') {
      res.statusCode = isLocalOrigin(origin) ? 204 : 403;
      res.end();
      return;
    }

    handler(req, res);
  });

  server.listen(port);
  return server;
}
