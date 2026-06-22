# @pointcut/core

## 0.2.0

### Minor Changes

- b57cb45: Deepen the toolbar client into tested models. The 4.3k-line `mount()`
  closure is now a thin DOM-glue layer; its geometry/placement math,
  display formatters, the four inspector controls, the agent/model picker,
  the agent Run lifecycle, and the CHANGE EDITOR state machine are extracted
  into pure `models/*.mjs` modules (each with co-located tests) and exported
  from `@pointcut/core/models`: `geometry`, `format`, `control`, `picker`,
  `run`, plus `reduceEditor`/`designValuePool` on `changes` and `srcLabel`
  on `loc`. Token-keyed Introspection that had leaked into the client
  (`readType`, `SPACING_SIDE`) moves back behind the typography/spacing
  models (ADR-0001). No client behaviour change.

## 0.1.0

### Minor Changes

- f375126: Vue + Vite tracer bullet: pick a live element, jump to its source.

  - **Vue Stamper** behind the `Stamper` registry interface (`test`/`transform`),
    routing through `magic-string` so it stamps `data-pointcut-loc="file:line:col"`
    onto opening template tags idempotently _and_ emits a real source map. Runs with
    `enforce: 'pre'`, before the Vue compiler.
  - **Auto-inject** of `import '@pointcut/core/client'` into the served page, with an
    `inject: false` escape hatch.
  - **Editor-launch** (`createEditorLaunch`) — the jump-to-source half of the Bridge,
    mounted by the Vite auto-attach under `/__pointcut/open`, resolving locs against
    the project root.
  - **Minimal Shadow-DOM client** — hover/lock Pick that resolves a clicked node to
    its stamp via the Locator and jumps to source.
  - **Design-mode hard guard** (`apply: 'serve'`): inert unless the plugin is opted in
    _and_ the build is dev/serve.
