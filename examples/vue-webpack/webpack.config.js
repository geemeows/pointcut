// Vue + Webpack tracer-bullet demo (issue #11).
//
// This is the whole point of the issue: the SAME one-plugin install as Vite
// brings the Bridge up under Webpack, with no extra wiring. `pointcut(...)` is a
// single unplugin entry; its `webpack(compiler)` hook mounts `createBridge()`
// onto `devServer.setupMiddlewares` automatically (auto-attach), and its
// `enforce:'pre'` transform runs as a webpack PRE-loader so the Source Stamp
// lands before `vue-loader` turns the template into render code.
//
// Two independent design-mode locks, exactly as with Vite:
//   • Lock #1 (yours): opt in behind a dev condition — `process.env.DESIGN`.
//   • Lock #2 (the plugin's): the auto-attach refuses to run when
//     `mode === 'production'`, so the Bridge can never ship to prod.
//
// Run design mode: `DESIGN=1 pnpm --filter @pointcut/example-vue-webpack dev`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpack from 'webpack';
import { VueLoaderPlugin } from 'vue-loader';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import pointcut from '@pointcut/unplugin/webpack';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read the HTML shell as a string and hand it to html-webpack-plugin via
// `templateContent` rather than `template`. A `template` FILE would be run
// through a child compilation whose loader chain includes Pointcut's
// `enforce:'pre'` transform loader, which conflicts with html-webpack-plugin's
// own template loader. The Source Stamp only needs to touch framework modules
// (.vue here), never the HTML shell, so keeping the shell out of the loader
// chain is correct, not a workaround.
const templateContent = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf8');

export default {
  entry: './src/main.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  resolve: {
    extensions: ['.js', '.vue'],
  },
  module: {
    rules: [
      { test: /\.vue$/, loader: 'vue-loader' },
      // The SFC's own <style> block; style-loader injects it as a <style> tag.
      // (The vendor UI kit is a real <link href> from node_modules in index.html
      //  — that is the provenance signal, NOT this app-owned style; issue #6.)
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    ],
  },
  plugins: [
    new VueLoaderPlugin(),
    new HtmlWebpackPlugin({ templateContent }),
    // vue-loader needs the SFC compiler flags; DefinePlugin also surfaces the
    // DESIGN dev lock to the browser bundle so main.js can gate the client import.
    new webpack.DefinePlugin({
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
      'process.env.DESIGN': JSON.stringify(process.env.DESIGN ?? ''),
    }),
    // The single Pointcut install. Behind the user's own dev condition (lock #1).
    // In a production build webpack passes `mode:'production'` and the
    // auto-attach hard guard (lock #2) keeps the Bridge inert regardless.
    process.env.DESIGN && pointcut({ framework: 'vue' }),
  ].filter(Boolean),
  devServer: {
    hot: true,
    // Serve node_modules so the UI kit's CSS keeps a real node_modules href in
    // dev (the provenance signal). The Pointcut auto-attach adds its own
    // `/__pointcut/*` middleware on top of whatever is configured here — it
    // wraps any `setupMiddlewares` you define instead of clobbering it.
    static: { directory: __dirname },
  },
};
