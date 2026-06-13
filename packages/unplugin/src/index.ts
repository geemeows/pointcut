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
        const agents = Array.isArray(options.agents) ? options.agents : undefined;
        const bridge = createBridge({ enabled: true, cwd: server.config.root, agents });
        server.middlewares.use(bridge);
      },
    },

    // Idiomatic native `define` for the remaining bundlers that expose one. Each
    // is the SAME substitution as the universal transform above (whichever runs
    // first wins); we wire it natively so the stamp survives each bundler's own
    // constant-folding/minification pass rather than relying on transform order.
    // These bundlers are dev-server-less in the Sidecar setup, so `bridge.port`
    // is the common case here — the client gets http://localhost:<port>.
    esbuild: {
      // esbuild's `define` needs valid JS expressions; `bridgeDefine` is a JSON
      // string literal, which is exactly that.
      config(buildOptions) {
        buildOptions.define = { ...buildOptions.define, [BRIDGE_PLACEHOLDER]: bridgeDefine };
      },
    },

    // Webpack/Rspack: inject their respective DefinePlugin. Resolved from the
    // running compiler's own webpack (`compiler.webpack`) so we bind to the
    // exact instance and add no dependency. Typed loosely (`any`) for the same
    // reason the Vite glue is — we touch only a documented structural subset.
    webpack(compiler: any) {
      const DefinePlugin = compiler?.webpack?.DefinePlugin;
      if (DefinePlugin) new DefinePlugin({ [BRIDGE_PLACEHOLDER]: bridgeDefine }).apply(compiler);
    },
    rspack(compiler: any) {
      const DefinePlugin = compiler?.webpack?.DefinePlugin;
      if (DefinePlugin) new DefinePlugin({ [BRIDGE_PLACEHOLDER]: bridgeDefine }).apply(compiler);
    },
  };
};

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory);
export default unplugin;
