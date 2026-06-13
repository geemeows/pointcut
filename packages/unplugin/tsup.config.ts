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
  clean: true,
});
