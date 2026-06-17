import { defineConfig } from 'tsup';

// No `clean` here: these three configs share one `dist/`, so a per-config clean
// races its siblings — and in `--watch` it would wipe `dist/` on startup, the
// window where examples resolve `@pointcut/core/dist/*` and crash. Cleaning is
// the `build` script's job (`rm -rf dist && tsup`); watch only ever adds files.
export default defineConfig([
  {
    // Node/library surface: models, drivers, Bridge guts.
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    dts: true,
  },
  {
    // Browser surface: the in-page toolbar client (injected in design mode only).
    entry: { 'client/index': 'src/client/index.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    dts: true,
  },
  {
    // Pure authoring models as a browser-safe entry (no Node deps), so in-page
    // consumers can import Tokens/Provenance without the Node bundle. tsup infers
    // .d.ts from the JSDoc-annotated .mjs sources (same as the main `index`
    // entry, which re-exports these), so the `./models` subpath ships types too.
    entry: { 'models/index': 'src/models/index.mjs' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    dts: true,
  },
]);
