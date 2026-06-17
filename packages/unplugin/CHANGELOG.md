# @pointcut/unplugin

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

### Patch Changes

- Updated dependencies [f375126]
  - @pointcut/core@0.1.0
