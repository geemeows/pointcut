import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  dts: true,
  // Cleaning is the `build` script's job (`rm -rf dist && tsup`); leaving it out
  // here keeps `--watch` from wiping `dist/` on startup, the window where
  // parallel example servers resolve this package's output and crash.
});
