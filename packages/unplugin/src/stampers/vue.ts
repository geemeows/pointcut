// Vue Source Stamp — the .vue SFC implementation of the Stamper interface.
//
// Lifted from the source toolbar's hand-rolled SFC transform (see CONTEXT.md,
// docs/adr/0001), name-neutralized (`data-luciq-loc` → `data-pointcut-loc`) and
// refactored to route through `magic-string` so it emits a real source map
// instead of `map: null`. It stamps `data-pointcut-loc="file:line:col"` onto
// every opening element tag inside a .vue <template> block, so a clicked DOM
// node resolves back to its exact spot in source at pick time.
//
// Vue markup is HTML-grammar, so the scan + magic-string engine, idempotency,
// and sourcemap live in the shared ./html-grammar module; this file supplies
// only the two Vue-specific rules: scan the inside of the <template> block, and
// skip the SFC's own <template> wrapper.
//
// MUST run before the Vue compiler turns the template into render code, so the
// owning unplugin sets `enforce: 'pre'` and we operate on raw .vue source — the
// line:col we compute then matches the real file. A stamp on a component usage
// (<MyButton>) marks the *usage* site, not the child's internals (intentional —
// that's the spot to edit).
import type { Stamper } from '../index';
import { createHtmlGrammarStamper, type ScanRegion } from './html-grammar';

// Re-export the contract attribute name so test/consumer imports of LOC_ATTR
// from this module keep working; the single source of truth lives in core.
export { LOC_ATTR } from '@pointcut/core';

// Match a single opening tag, tolerating attribute values that contain '>'
// by consuming quoted strings whole. Captures: 1=tag name, 2=attrs, 3=self-close.
const OPEN_TAG = /<([a-zA-Z][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

// Locate the first <template ...> ... </template> (top-level SFC block).
const TEMPLATE_BLOCK = /<template(?:\s[^>]*)?>([\s\S]*?)<\/template>/;

// The scan region is the <template> inner content, blanked everywhere else so
// match indices still line up 1:1 with the original file. Returning null (no
// <template>) short-circuits the engine to "nothing stamped".
function templateRegion(code: string): ScanRegion | null {
  const block = TEMPLATE_BLOCK.exec(code);
  if (!block) return null;
  const inner = block[1] ?? '';
  const innerStart = block.index + block[0].indexOf(inner);
  // Same-length scan string: only the template inner survives, rest is spaces.
  const scan =
    ' '.repeat(innerStart) + inner + ' '.repeat(code.length - innerStart - inner.length);
  return { scan, offset: 0 };
}

/** Build the Vue Stamper. `root` is the project root locs are made relative to. */
export function createVueStamper(root: string = process.cwd()): Stamper {
  return createHtmlGrammarStamper(
    root,
    // Only app .vue source (strip any query); never node_modules.
    (id) => {
      const file = id.split('?')[0] ?? id;
      return file.endsWith('.vue') && !file.includes('node_modules');
    },
    {
      openTag: OPEN_TAG,
      region: templateRegion,
      // Skip the SFC's own <template> wrappers (no DOM output).
      skip: (tag) => tag.toLowerCase() === 'template',
    },
  );
}
