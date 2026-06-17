# @pointcut/core

The bundler-free, framework-free guts of [Pointcut](https://github.com/geemeows/pointcut) — a
dev-only, design-mode-gated in-browser toolbar where you **point** at a live DOM element and the
intended change is **cut** into source by an AI coding agent.

Most users never install this directly — it comes in as a dependency of
[`@pointcut/unplugin`](https://www.npmjs.com/package/@pointcut/unplugin) and
[`@pointcut/sidecar`](https://www.npmjs.com/package/@pointcut/sidecar). It's published on its
own because both of those mount the **same** Bridge from here, so the auto-attach and sidecar
paths can't diverge.

This package owns:

- **The Bridge** — `createBridge()`, the dev-server runtime surface that turns toolbar intent
  into agent edits (editor-launch, agent-probe, skills-probe, and the agent run that normalizes
  each agent CLI's native events into a uniform NDJSON `Action` stream). Consumers only mount
  the handler.
- **Drivers** — a per-agent module (claude / codex / cursor) that owns one CLI's recipe. Adding
  an agent is one driver plus one registry entry; the Bridge, protocol, and client never change.
- **Models** — pure, framework-free authoring models (queue, locator, tokens, provenance,
  spacing, color, typography, copy, chat, handoff, agent-run) with injected collaborators.
- **The client** — the minimal Shadow-DOM in-page toolbar (`@pointcut/core/client`).

A **design-mode hard guard** lives here: the Bridge refuses to construct unless explicitly
enabled, so every consumer inherits the same gate. Pointcut never ships to production.

## Install

```bash
npm install -D @pointcut/core
```

## Entry points

```js
import { createBridge, getDriver, DRIVERS } from '@pointcut/core';
import '@pointcut/core/client';           // the in-page toolbar (usually auto-injected)
import { /* models */ } from '@pointcut/core/models';
```

```js
const handler = createBridge({ enabled: true, cwd: process.cwd() });
// mount `handler` on any Node HTTP server / dev-server middleware
```

See the [main README](https://github.com/geemeows/pointcut#readme) for architecture and usage.

## License

[MIT](./LICENSE)
