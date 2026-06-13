// @pointcut/unplugin — the universal transform/inject plugin (ADR-0002).
//
// Two jobs on the transform side, both genuinely shared across bundlers:
//   1. Source Stamp — write data-pointcut-loc onto opening element tags, via a
//      pluggable per-framework Stamper registry (string+magic-string for
//      HTML-grammars; Babel/SWC AST for JSX).
//   2. Inject — auto-prepend `import '@pointcut/core/client'` into the entry
//      (opt out with `inject:false` and import it yourself).
// Plus the thin per-dev-server auto-attach glue that mounts the Bridge
// (here: editor-launch via createEditorLaunch — the #4 tracer-bullet slice).
import { fileURLToPath } from 'node:url';
import { createUnplugin, type UnpluginFactory } from 'unplugin';
import { createBridge } from '@pointcut/core';
import { createVueStamper } from './stampers/vue';
import { createJsxStamper } from './stampers/jsx';
import { createSvelteStamper } from './stampers/svelte';
import { createHtmlStamper } from './stampers/html';

export type Framework = 'auto' | 'vue' | 'jsx' | 'svelte' | 'html';

export interface PointcutOptions {
  /** Frontend framework; 'auto' routes by file extension. */
  framework?: Framework;
  /** Auto-inject the client into the entry. Set false to import it yourself. */
  inject?: boolean;
  /** Agent allow-list, or 'auto' to offer every installed CLI on PATH. */
  agents?: 'auto' | string[];
  /** Bridge wiring. `port` is stamped into the client as its base URL. */
  bridge?: { port?: number };
  /** Optional design-token grouping hints. Refinement only — zero-config works. */
  tokens?: Record<string, string>;
}

/** A pluggable per-framework Source Stamp implementation. */
export interface Stamper {
  /** Does this stamper own the given module id? */
  test(id: string): boolean;
  /** Stamp data-pointcut-loc; return null to leave the module untouched. */
  transform(code: string, id: string): { code: string; map: unknown } | null;
}

/** The import the client is injected as. Re-exported so consumers can opt out. */
export const CLIENT_IMPORT = '@pointcut/core/client';

// Resolve the client to an absolute file path from THIS package, which always
// depends on @pointcut/core — so injection never relies on the consumer's app
// being able to resolve `@pointcut/core` itself. Under pnpm's strict layout the
// consumer only links `@pointcut/unplugin`; `@pointcut/core` is nested here and
// is NOT resolvable from their app root, so a bare `import '@pointcut/core/client'`
// injected into their page fails ("Failed to resolve import"). Resolving here and
// handing Vite an absolute path (served via `/@fs/`) sidesteps that entirely.
function resolveClientPath(): string | null {
  try {
    // `import.meta.resolve` (not `require.resolve`): core's `./client` export is
    // ESM-only (`import` condition, no `require`), so CJS resolution throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED. ESM resolution honours the `import` condition.
    return fileURLToPath(import.meta.resolve(CLIENT_IMPORT));
  } catch {
    return null;
  }
}

// The single source of truth for the auto-attached Bridge. Every dev-server
// path (Vite `configureServer`, Webpack/Rspack `setupMiddlewares`) and the
// Sidecar mount the SAME handler — no divergence (CONTEXT.md: "the same
// `createBridge()` handler used by the Vite auto-attach and the Sidecar").
// `enabled: true` is pinned because the caller has already cleared the
// design-mode guard; `agents` is normalised exactly as the Vite path does
// (an explicit array is the allow-list, anything else means 'auto'). `cwd` is
// the only per-server difference: Vite reads `server.config.root`, Webpack and
// Rspack read `compiler.options.context`.
function makeBridge(cwd: string, agents: PointcutOptions['agents']) {
  const allowList = Array.isArray(agents) ? agents : undefined;
  return createBridge({ enabled: true, cwd, agents: allowList });
}

// Resolve the active Stamper set for the configured framework. An explicit
// framework forces exactly that stamper; 'auto' returns every available stamper
// and lets each one's `test()` self-gate by file extension (.vue → Vue,
// .jsx/.tsx → JSX, .svelte → Svelte, .html → HTML).
function resolveStampers(framework: Framework): Stamper[] {
  switch (framework) {
    case 'vue':
      return [createVueStamper()];
    case 'jsx':
      return [createJsxStamper()];
    case 'svelte':
      return [createSvelteStamper()];
    case 'html':
      return [createHtmlStamper()];
    case 'auto':
      return [createVueStamper(), createJsxStamper(), createSvelteStamper(), createHtmlStamper()];
    default:
      return [];
  }
}

// The compile-time placeholder the client reads to find the Bridge. It is the
// ONE base-URL coupling point: empty string = same-origin (auto-attach mounts
// the Bridge on the running dev server), otherwise the Sidecar's cross-origin
// URL (dev-server-less Rollup/Rolldown/esbuild/Farm — ADR-0002). The client
// guards with `typeof __POINTCUT_BRIDGE__ === 'string'`, so the value we stamp
// is always a JSON string literal (never `undefined`).
const BRIDGE_PLACEHOLDER = '__POINTCUT_BRIDGE__';

// Resolve the Bridge base URL the client should fetch against. A configured
// `bridge.port` is the Sidecar signal — the client lives in the static build
// and reaches the Sidecar cross-origin at http://localhost:<port>. With no
// port we are on the auto-attach path: same-origin, so the base URL is empty.
function resolveBridgeBase(bridge: PointcutOptions['bridge']): string {
  return bridge?.port ? `http://localhost:${bridge.port}` : '';
}

export const unpluginFactory: UnpluginFactory<PointcutOptions | undefined> = (options = {}) => {
  const stampers = resolveStampers(options.framework ?? 'auto');
  const inject = options.inject !== false;

  // The literal we substitute for the placeholder, computed once. It is always
  // a JSON-encoded string (`""` for same-origin, `"http://localhost:<port>"`
  // for the Sidecar) so it drops straight into the client's `typeof … ===
  // 'string'` guard and `bridgeBase` assignment.
  const bridgeDefine = JSON.stringify(resolveBridgeBase(options.bridge));

  return {
    name: '@pointcut/unplugin',
    enforce: 'pre', // must run before the framework compiler turns templates/JSX into render code

    // Two transform jobs, both genuinely shared across every bundler:
    //   1. Source Stamp — route each module to the first Stamper that owns it.
    //   2. Bridge base-URL stamp — replace the __POINTCUT_BRIDGE__ placeholder
    //      with the resolved value. unplugin exposes no single universal
    //      `define`, so we do the substitution here (the transform hook IS
    //      universal): this covers Rollup/Rolldown/Farm — the dev-server-less
    //      bundlers that actually need the Sidecar URL — with no per-bundler
    //      define and no @rollup/plugin-replace dependency. The idiomatic native
    //      `define` is ALSO wired below for the bundlers that have one
    //      (Vite/esbuild/Webpack/Rspack); it is identical in effect, so
    //      whichever fires first wins and the other finds nothing left to do.
    transform(code, id) {
      for (const stamper of stampers) {
        if (stamper.test(id)) {
          const result = stamper.transform(code, id);
          // magic-string's SourceMap satisfies the bundler's map input; the
          // Stamper interface keeps `map` opaque so it owns no unplugin types.
          // Stamped modules are never the client, so no base-URL stamp here.
          return result ? { code: result.code, map: result.map as never } : undefined;
        }
      }
      // Not a stamped module: stamp the Bridge base URL if the placeholder is
      // present (the client module, once it reaches the bundler). A plain
      // string replace keeps this framework-free and dependency-free.
      if (code.includes(BRIDGE_PLACEHOLDER)) {
        return { code: code.split(BRIDGE_PLACEHOLDER).join(bridgeDefine), map: null };
      }
      return undefined;
    },

    // Vite-specific glue. `apply: 'serve'` is the design-mode hard guard: even
    // when a user opts the plugin into their config, it stays inert in a
    // production build — Pointcut never ships to prod (CONTEXT.md, ADR-0001).
    vite: {
      apply: 'serve',

      // Idiomatic native `define` (mirrors the universal transform stamp above):
      // Vite substitutes the placeholder for the resolved base URL. Same effect
      // as the transform path — Vite is the auto-attach (same-origin) case, so
      // this is `""`, but a configured `bridge.port` flows through identically.
      config() {
        return { define: { [BRIDGE_PLACEHOLDER]: bridgeDefine } };
      },

      // Inject — auto-attach the client to the served page. `inject: false`
      // suppresses it so the consumer imports '@pointcut/core/client' itself.
      transformIndexHtml() {
        if (!inject) return undefined;
        const clientPath = resolveClientPath();
        if (!clientPath) return undefined;
        // Serve the client by absolute path via Vite's `/@fs/` dev URL (POSIX
        // separators). This is already a concrete URL the browser fetches, so —
        // unlike an inline bare `import` — it needs no import-analysis pass and
        // resolves regardless of the consumer's node_modules layout.
        const fsUrl = `/@fs/${clientPath.replace(/\\/g, '/')}`;
        return [
          {
            tag: 'script',
            attrs: { type: 'module', src: fsUrl },
            injectTo: 'body',
          },
        ];
      },

      // Auto-attach — mount the full Bridge (editor-launch + agent-probe +
      // agent-run) on the running dev server. `enabled: true` because
      // `apply: 'serve'` already gates us. `agents: 'auto'` (or absent) offers
      // every installed CLI on PATH; an explicit array is the allow-list.
      // `server` is loosely typed (`any`) on purpose: the structural shape we
      // need (config.root + middlewares.use) is a subset of Vite's ViteDevServer,
      // and `middlewares.use` accepts a connect handler — our BridgeHandler fits.
      configureServer(server: { config: { root: string }; middlewares: { use: (handler: any) => void } }) {
        server.middlewares.use(makeBridge(server.config.root, options.agents));
      },
    },

    // esbuild base-URL stamp. Idiomatic native `define` — the SAME substitution
    // as the universal transform above (whichever runs first wins); we wire it
    // natively so the stamp survives esbuild's own constant-folding/minification
    // pass rather than relying on transform order. esbuild is dev-server-less in
    // the Sidecar setup, so `bridge.port` is the common case here — the client
    // gets http://localhost:<port>. esbuild's `define` needs a valid JS
    // expression; `bridgeDefine` is a JSON string literal, which is exactly that.
    esbuild: {
      config(buildOptions) {
        buildOptions.define = { ...buildOptions.define, [BRIDGE_PLACEHOLDER]: bridgeDefine };
      },
    },

    // Webpack does two jobs here, both via the running compiler:
    //   1. Auto-attach (issue #11). Webpack's unplugin config object has no
    //      `apply: 'serve'` distinction (that lock is Vite-only), so the
    //      design-mode hard guard lives in `mountBridgeOnDevServer`: it mounts the
    //      Bridge ONLY when `mode !== 'production'` (lock #2), riding the
    //      `devServer.setupMiddlewares` hook with the SAME handler the Vite path
    //      uses via `makeBridge`, and wrapping any user-defined middleware.
    //   2. Base-URL stamp (issue #12). Inject webpack's own DefinePlugin —
    //      resolved from `compiler.webpack` so we bind to the exact instance and
    //      add no dependency — mirroring the universal transform stamp so the
    //      value survives webpack's constant-folding. `compiler` is loosely typed
    //      (`any`) for the same reason `server` is on the Vite path: we touch only
    //      a small documented structural subset of webpack's Compiler.
    webpack(compiler: any) {
      mountBridgeOnDevServer(compiler, options.agents);
      const DefinePlugin = compiler?.webpack?.DefinePlugin;
      if (DefinePlugin) new DefinePlugin({ [BRIDGE_PLACEHOLDER]: bridgeDefine }).apply(compiler);
    },

    // Rspack — identical contract to Webpack (Rspack is a drop-in
    // webpack-compatible compiler with the same `devServer.setupMiddlewares` hook
    // and DefinePlugin), so it does the same two jobs through the same helpers.
    // Parity with Vite means one install, one Bridge, no per-bundler behavioural
    // drift (issue #11, AC #3).
    rspack(compiler: any) {
      mountBridgeOnDevServer(compiler, options.agents);
      const DefinePlugin = compiler?.webpack?.DefinePlugin;
      if (DefinePlugin) new DefinePlugin({ [BRIDGE_PLACEHOLDER]: bridgeDefine }).apply(compiler);
    },
  };
};

// Shared Webpack/Rspack auto-attach. Both bundlers expose the same Compiler
// shape and the same `devServer.setupMiddlewares` dev-server hook, so the glue
// is identical — factored out so Webpack and Rspack can NEVER diverge.
//
// The production hard guard (lock #2) lives here: in a production build we
// return immediately and never touch `devServer`, so the Bridge cannot attach.
// In dev we ensure a `devServer` object exists, then install/wrap
// `setupMiddlewares` to prepend the Bridge handler ahead of the user's chain.
function mountBridgeOnDevServer(compiler: any, agents: PointcutOptions['agents']): void {
  const compilerOptions = compiler?.options ?? {};

  // Lock #2: refuse to run in a production build. webpack/rspack default `mode`
  // to 'production' when unset, so treating only an explicit non-production mode
  // as design-mode is the safe, fail-closed choice (Design Mode never ships).
  if (compilerOptions.mode === 'production') return;

  const bridge = makeBridge(compilerOptions.context ?? process.cwd(), agents);

  // Ensure a devServer config exists so the dev server (webpack-dev-server /
  // @rspack/dev-server) picks up our middleware. We never overwrite a user's
  // devServer block — only add the one hook we need.
  const devServer = (compilerOptions.devServer ??= {});

  // Wrap any pre-existing `setupMiddlewares` so the user's customisation is
  // preserved: prepend the Bridge (it must see requests first to claim
  // `/__pointcut/*`), then hand the chain to the user's hook (or return it
  // unchanged when they have none). The signature mirrors webpack-dev-server's
  // `(middlewares, devServerInstance) => middlewares`.
  const userSetup = typeof devServer.setupMiddlewares === 'function' ? devServer.setupMiddlewares : undefined;
  devServer.setupMiddlewares = (middlewares: any[], devServerInstance: any) => {
    middlewares.unshift({ name: 'pointcut-bridge', middleware: bridge });
    return userSetup ? userSetup(middlewares, devServerInstance) : middlewares;
  };
}

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory);
export default unplugin;
