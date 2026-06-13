import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // Node/library surface: models, drivers, Bridge guts.
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    dts: true,
    clean: true,
  },
  {
    // Browser surface: the in-page toolbar client (injected in design mode only).
    entry: { 'client/index': 'src/client/index.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    dts: true,
  },
]);
