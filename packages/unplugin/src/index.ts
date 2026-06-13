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

export const unpluginFactory: UnpluginFactory<PointcutOptions | undefined> = (options = {}) => {
  const stampers = resolveStampers(options.framework ?? 'auto');
  const inject = options.inject !== false;

  return {
    name: '@pointcut/unplugin',
    enforce: 'pre', // must run before the framework compiler turns templates/JSX into render code

    // Source Stamp — route each module to the first Stamper that owns it.
    transform(code, id) {
      for (const stamper of stampers) {
        if (stamper.test(id)) {
          const result = stamper.transform(code, id);
          // magic-string's SourceMap satisfies the bundler's map input; the
          // Stamper interface keeps `map` opaque so it owns no unplugin types.
          return result ? { code: result.code, map: result.map as never } : undefined;
        }
      }
      return undefined;
    },

    // Vite-specific glue. `apply: 'serve'` is the design-mode hard guard: even
    // when a user opts the plugin into their config, it stays inert in a
    // production build — Pointcut never ships to prod (CONTEXT.md, ADR-0001).
    vite: {
      apply: 'serve',

      // Inject — auto-attach the client to the served page. `inject: false`
      // suppresses it so the consumer imports '@pointcut/core/client' itself.
      transformIndexHtml() {
        if (!inject) return undefined;
        return [
          {
            tag: 'script',
            attrs: { type: 'module' },
            children: `import ${JSON.stringify(CLIENT_IMPORT)}`,
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

    // Webpack auto-attach. Webpack's unplugin config object has no
    // `apply: 'serve'` distinction (that lock is Vite-only), so the design-mode
    // hard guard is implemented here directly: we mount the Bridge ONLY when the
    // compiler is not a production build (`mode !== 'production'`). That is lock
    // #2 — even if a user wired the plugin into a prod webpack config, the Bridge
    // would never attach. Lock #1 (the user's own dev condition, e.g.
    // `process.env.DESIGN`) still lives in their config, exactly as with Vite.
    //
    // The Bridge rides the dev-server middleware hook
    // (`devServer.setupMiddlewares`, the webpack-dev-server v4+ replacement for
    // the deprecated before/after hooks). We register the SAME handler the Vite
    // path mounts via `makeBridge`, and we WRAP any existing `setupMiddlewares`
    // so a user who already customises their middleware chain keeps it: we prepend
    // the Bridge, then delegate to theirs (or pass `middlewares` through untouched
    // when they have none). `compiler` is loosely typed (`any`) for the same
    // reason `server` is on the Vite path: we only touch a small structural subset
    // of webpack's Compiler (`options.mode`, `options.context`,
    // `options.devServer`), and pulling in webpack's types here would make this
    // bundler-agnostic package depend on a single bundler.
    webpack(compiler: any) {
      mountBridgeOnDevServer(compiler, options.agents);
    },

    // Rspack auto-attach — identical contract to Webpack (Rspack is a drop-in
    // webpack-compatible compiler with the same `devServer.setupMiddlewares`
    // hook), so it delegates to the very same helper. Keeping this a one-liner is
    // the point: parity with Vite means one install, one Bridge, no per-bundler
    // behavioural drift (issue #11, AC #3).
    rspack(compiler: any) {
      mountBridgeOnDevServer(compiler, options.agents);
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
