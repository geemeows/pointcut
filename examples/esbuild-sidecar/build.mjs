// Standalone esbuild build/watch — NO dev-server middleware hook (ADR-0002).
//
// This is the dev-server-less case the Sidecar exists for. esbuild only bundles
// + serves static files; it has no place to mount the Bridge. So:
//   • the Pointcut esbuild plugin stamps source (data-pointcut-loc) AND stamps
//     the client's __POINTCUT_BRIDGE__ base URL to the Sidecar (bridge.port);
//   • the Bridge itself runs in a SEPARATE process: `npx pointcut-sidecar`.
// The client then reaches the Sidecar cross-origin; the Sidecar is CORS-locked
// to localhost so only this loopback page can talk to it.
import esbuild from 'esbuild';
import pointcut from '@pointcut/unplugin/esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

const SIDECAR_PORT = Number(process.env.POINTCUT_PORT ?? 7321);
const SERVE_PORT = Number(process.env.PORT ?? 5180);
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/main.jsx'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/main.js',
  // Classic JSX → our tiny hyperscript (no React). The Pointcut Source Stamp
  // runs BEFORE this transform (unplugin enforce: 'pre'), so each host tag is
  // already stamped by the time esbuild lowers JSX to h(...) calls.
  jsx: 'transform',
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  loader: { '.jsx': 'jsx' },
  // Copy index.html alongside the bundle so the static server can serve it.
  // (esbuild has no html plugin; the file references ./main.js relatively.)
  plugins: [
    pointcut({
      // dev-server-less: stamp the client's Bridge base URL at the Sidecar.
      framework: 'jsx',
      inject: false, // esbuild has no transformIndexHtml; we import the client in main.jsx
      bridge: { port: SIDECAR_PORT },
    }),
    copyIndexHtml(),
  ],
});

if (watch) {
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: 'dist', port: SERVE_PORT });
  // eslint-disable-next-line no-console
  console.log(`\n[demo] app:     http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  // eslint-disable-next-line no-console
  console.log(`[demo] sidecar: run \`POINTCUT_PORT=${SIDECAR_PORT} npx pointcut-sidecar\` in another terminal\n`);
} else {
  await ctx.rebuild();
  await ctx.dispose();
  // eslint-disable-next-line no-console
  console.log('[demo] built to dist/');
}

/** Tiny esbuild plugin: copy index.html into the outdir on every build. */
function copyIndexHtml() {
  return {
    name: 'copy-index-html',
    setup(build) {
      build.onEnd(async () => {
        await mkdir('dist', { recursive: true });
        await copyFile('index.html', 'dist/index.html');
      });
    },
  };
}
