import { defineConfig } from 'tsup';

export default defineConfig({
  // One entry per bundler so `@pointcut/unplugin/vite`, `/webpack`, ... resolve.
  entry: {
    index: 'src/index.ts',
    vite: 'src/vite.ts',
    rollup: 'src/rollup.ts',
    webpack: 'src/webpack.ts',
    rspack: 'src/rspack.ts',
    esbuild: 'src/esbuild.ts',
    farm: 'src/farm.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  dts: true,
  // Cleaning is the `build` script's job (`rm -rf dist && tsup`); leaving it out
  // here keeps `--watch` from wiping `dist/` on startup, the window where
  // parallel example servers resolve `@pointcut/unplugin/*` and crash.
});
