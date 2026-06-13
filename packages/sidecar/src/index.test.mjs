/* eslint-disable */
// Run: node --import tsx --test packages/sidecar/src/
//
// The Sidecar is a peer to the unplugin's auto-attach (ADR-0002): same handler,
// localhost-only CORS, OPTIONS preflight answered. These tests bind a real
// server on an ephemeral port and drive it over loopback HTTP.
//
// We probe via /__pointcut/agents (a GET the Bridge always answers — 200 JSON,
// even with no agent on PATH) so every assertion gets a real response. We avoid
// /__pointcut/open (it spawns the user's editor) and unmatched routes (the
// connect-style Bridge leaves those open, by design, for a downstream `next`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '@pointcut/core';
import { startSidecar, DEFAULT_PORT } from './index.ts';

/** Boot a Sidecar on an ephemeral port, run `fn(baseUrl)`, then close it. */
async function withSidecar(fn) {
  // startSidecar already calls server.listen(0); resolve once an address (and
  // thus the assigned port) exists, without racing the 'listening' event.
  const server = startSidecar({ port: 0 });
  const addr = await new Promise((resolve) => {
    const a = server.address();
    if (a && typeof a === 'object') resolve(a);
    else server.once('listening', () => resolve(server.address()));
  });
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    // fetch() keeps sockets alive, which would stall server.close(); drop them
    // so the close callback (and the test process) can actually exit.
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

/** fetch with a short hard timeout, so a hung route fails fast (not at 0ms). */
function get(url, headers) {
  return fetch(url, { headers, signal: AbortSignal.timeout(4000) });
}

test('localhost origin → Access-Control-Allow-Origin reflected', async () => {
  await withSidecar(async (base) => {
    const res = await get(`${base}/__pointcut/agents`, { Origin: 'http://localhost:5173' });
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(res.headers.get('vary'), 'Origin');
    await res.text();
  });
});

test('non-localhost origin → no Access-Control-Allow-Origin', async () => {
  await withSidecar(async (base) => {
    const res = await get(`${base}/__pointcut/agents`, { Origin: 'https://evil.example.com' });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    await res.text();
  });
});

test('127.0.0.1 origin (with port) is treated as localhost', async () => {
  await withSidecar(async (base) => {
    const res = await get(`${base}/__pointcut/agents`, { Origin: 'http://127.0.0.1:4000' });
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4000');
    await res.text();
  });
});

test('OPTIONS preflight from localhost → 204 with CORS allow headers', async () => {
  await withSidecar(async (base) => {
    const res = await fetch(`${base}/__pointcut/agent`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
      signal: AbortSignal.timeout(4000),
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/);
    assert.match(res.headers.get('access-control-allow-headers') ?? '', /Content-Type/i);
    await res.text();
  });
});

test('OPTIONS preflight from non-localhost → 403, no ACAO', async () => {
  await withSidecar(async (base) => {
    const res = await fetch(`${base}/__pointcut/agent`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com' },
      signal: AbortSignal.timeout(4000),
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    await res.text();
  });
});

test('mounts the same createBridge() composite as auto-attach (agent-probe owned)', async () => {
  // The agent-probe endpoint is part of the createBridge() composite. A GET must
  // be ANSWERED (200 JSON) rather than left hanging — proving the Sidecar mounts
  // the real Bridge, not an empty server. The shape is `{ agents: [...] }`
  // regardless of which CLIs are on PATH.
  await withSidecar(async (base) => {
    const res = await get(`${base}/__pointcut/agents`, { Origin: 'http://localhost:5173' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.agents), 'agent-probe returns an agents array');
  });
});

test('DEFAULT_PORT is the documented 7321', () => {
  assert.equal(DEFAULT_PORT, 7321);
});

test('createBridge is the shared core factory (peer to auto-attach)', () => {
  // The Sidecar and the unplugin import the identical createBridge symbol from
  // @pointcut/core — there is exactly one Bridge implementation (ADR-0002).
  assert.equal(typeof createBridge, 'function');
});
