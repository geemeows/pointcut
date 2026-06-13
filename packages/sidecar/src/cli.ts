#!/usr/bin/env node
// `npx pointcut-sidecar` — launch the standalone Bridge.
import { startSidecar, DEFAULT_PORT } from './index';

const port = Number(process.env.POINTCUT_PORT ?? DEFAULT_PORT);
startSidecar({ port });
// eslint-disable-next-line no-console
console.log(`[pointcut] sidecar listening on http://localhost:${port}`);
