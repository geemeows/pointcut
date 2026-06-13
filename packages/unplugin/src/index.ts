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
import { createEditorLaunch } from '@pointcut/core';
import { createVueStamper } from './stampers/vue';
import { createSvelteStamper } from './stampers/svelte';

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

// Resolve the active Stamper set for the configured framework. Each stamper's
// test() gates by extension, so 'auto' just hands over every ported stamper and
// lets the file id pick the owner. JSX / HTML join as they're ported.
function resolveStampers(framework: Framework): Stamper[] {
  switch (framework) {
    case 'vue':
      return [createVueStamper()];
    case 'svelte':
      return [createSvelteStamper()];
    case 'auto':
      return [createVueStamper(), createSvelteStamper()];
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

      // Auto-attach — mount the Bridge's editor-launch endpoint on the running
      // dev server. `enabled: true` because `apply: 'serve'` already gates us.
      configureServer(server: {
        config: { root: string };
        middlewares: { use: (handler: unknown) => void };
      }) {
        const editorLaunch = createEditorLaunch({ enabled: true, cwd: server.config.root });
        server.middlewares.use(editorLaunch);
      },
    },
  };
};

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory);
export default unplugin;
