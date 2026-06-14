# Pointcut

A dev-only, design-mode-gated in-browser toolbar: you **point** at a live DOM element and the intended change is **cut** into source by an AI coding agent. Framework-agnostic (vanilla client) and bundler-agnostic (one `unplugin` plugin + a standalone sidecar). It is a clean-room standalone tool — it carries **no** vocabulary, tokens, or component knowledge from the app it was extracted from; everything design-system-specific is introspected from the installing project at runtime.

## Language

**Pointcut**:
The whole tool. A floating toolbar injected into a running app during local dev only.
_Avoid_: design toolbar, plugin

**Source Stamp**:
The compile-time transform that writes `data-pointcut-loc="file:line:col"` onto every opening element tag, so a clicked DOM node resolves back to its exact spot in source. Pluggable per framework (Vue SFC / JSX-TSX / Svelte / plain HTML).
_Avoid_: loc attribute, stamper, data-luciq-loc (luciq-coupled, do not use)

**Bridge**:
The dev-server runtime surface that turns toolbar intent into agent edits. Three endpoints under a neutral `/__pointcut/*` prefix: editor-launch, agent-probe, and the agent run (spawns the chosen agent CLI, normalizes its native events into a uniform NDJSON Action stream). Its guts live framework-free in `@pointcut/core` as `createBridge()`; consumers only mount the handler.
_Avoid_: server, middleware, proxy, /__luciq_* (luciq-coupled)

**Driver**:
A per-agent module (claude / codex / cursor) that owns one agent CLI's recipe: build args, parse native events into Actions. Adding an agent = one driver + one registry entry; Bridge/protocol/client never change.

**Action**:
A normalized event in the uniform NDJSON stream the Bridge emits: `{t:'action',a}` | `{t:'error',m}` | `{t:'end',code}`. Drivers translate each agent's native events into Actions.

**Annotation**:
A single numbered pick — a DOM element or marqueed region captured with a type tag and a jump-to-source link. Annotations accumulate in the Queue/Session.

**Introspection**:
How Pointcut stays design-system-agnostic. Tokens, style provenance, and component identity are **read from the installing project's live CSSOM and Source Stamps at runtime**, not configured per design system. The browser already holds the resolved cascade; Pointcut reverse-maps from it.
_Avoid_: adapter, NDS, Spark (luciq-coupled design-system specifics — do not bake in)

**Design Mode**:
The dev-only state in which Pointcut is active. Gated by two independent locks: the user explicitly opting the plugin into their config behind their own dev condition, AND the plugin's internal hard guard that refuses to run in a production build. Never ships to production.
_Avoid_: debug mode, dev mode (Design Mode is narrower — Pointcut-active, not merely non-prod)

**Sidecar**:
A standalone Node server that mounts the same `createBridge()` handler on a bare HTTP server. The universal runtime for bundlers without a dev-server middleware hook (standalone Rollup/Rolldown/esbuild), and a peer to the auto-attach path — not a second-class fallback.

**Auto-attach**:
The thin per-dev-server glue inside `@pointcut/unplugin` that calls `createBridge()` and registers it on the running dev server (Vite `configureServer`, Webpack/Rspack `setupMiddlewares`). The transform side is genuinely shared across bundlers; this Bridge glue is honestly per-bundler but tiny.

## Relationships

- A **Pointcut** install = one **unplugin** (transform + inject + **Auto-attach** of the **Bridge**) where a dev server exists; otherwise the **Sidecar**.
- The **Source Stamp** (transform side) and the **Bridge** (runtime side) are the only two coupling points; they have different bundler-agnostic strategies.
- A **Bridge** uses a **Driver** to run an agent and emits **Action**s.
- **Introspection** depends on the **Source Stamp** for component identity and on the CSSOM for tokens + provenance.
- `@pointcut/core` owns the **Bridge** guts, **Driver**s, models, and client — bundler-free and framework-free.

## Flagged ambiguities

- "plugin" was overloaded (the build plugin vs. the whole tool) — resolved: the tool is **Pointcut**; the build-time piece is the **unplugin**.
- luciq-specific names from the source handoff (`data-luciq-loc`, `/__luciq_*`, NDS tokens, Spark components) are **not** Pointcut vocabulary — they are coupling to be stripped, renamed to neutral equivalents, or replaced by runtime Introspection.
