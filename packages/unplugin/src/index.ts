// @pointcut/unplugin — the universal transform/inject plugin (ADR-0002).
//
// Two jobs on the transform side, both genuinely shared across bundlers:
//   1. Source Stamp — write data-pointcut-loc onto opening element tags, via a
//      pluggable per-framework Stamper registry (string+magic-string for
//      HTML-grammars; Babel/SWC AST for JSX).
//   2. Inject — auto-prepend `import '@pointcut/core/client'` into the entry
//      (opt out with `inject:false` and import it yourself).
// Plus the thin per-dev-server auto-attach glue that mounts createBridge()
// (lives in the per-bundler entry files, e.g. Vite configureServer).
import { createUnplugin, type UnpluginFactory } from 'unplugin';

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

export const unpluginFactory: UnpluginFactory<PointcutOptions | undefined> = (_options = {}) => ({
  name: '@pointcut/unplugin',
  enforce: 'pre', // must run before the framework compiler turns templates/JSX into render code
  transform(_code, _id) {
    // Source Stamp + inject land here; stub keeps the build green.
    return null;
  },
});

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory);
export default unplugin;
