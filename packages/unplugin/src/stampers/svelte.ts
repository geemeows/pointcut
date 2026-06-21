// Svelte Source Stamp — the .svelte implementation of the Stamper interface.
//
// Svelte markup is HTML-grammar, so this reuses the shared scan + magic-string
// engine (see ./html-grammar.ts), name-neutral throughout (`data-pointcut-loc`).
// It stamps `data-pointcut-loc="file:line:col"` onto every opening element tag
// in a .svelte file, so a clicked DOM node resolves back to its exact spot in
// source at pick time.
//
// Unlike a .vue SFC, a .svelte file has no <template> wrapper — the markup *is*
// the file, minus its <script> and <style> blocks. So instead of locating a
// template block, we carve those non-DOM regions out (blank them to same-length
// spaces) and only stamp the markup that remains. Svelte logic blocks
// ({#if}/{#each}) aren't element tags, so the OPEN_TAG regex skips them for
// free; the one markup tag we must NOT stamp is a <svelte:*> special element
// (<svelte:head>, <svelte:component>, …) — those are compiler directives, not
// DOM. Component usages (<MyButton>) follow the Vue rule: stamp the *usage*
// site, the spot to edit.
//
// MUST run before the Svelte compiler turns markup into render code, so the
// owning unplugin sets `enforce: 'pre'` and we operate on raw .svelte source —
// the line:col we compute then matches the real file.
import type { Stamper } from '../index';
import { createHtmlGrammarStamper, type ScanRegion } from './html-grammar';

// Re-export the contract attribute name so test/consumer imports of LOC_ATTR
// from this module keep working; the single source of truth lives in core.
export { LOC_ATTR } from '@pointcut/core';

// Match a single opening tag, tolerating attribute values that contain '>' by
// consuming quoted strings whole. The tag-name class allows ':' so <svelte:*>
// matches (and is then skipped). Captures: 1=tag name, 2=attrs, 3=self-close.
const OPEN_TAG = /<([a-zA-Z][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

// Top-level non-DOM blocks: <script> and <style>. Their bodies are JS/CSS, never
// markup, so we blank them out before stamping (keeping length/offsets intact).
const SCRIPT_OR_STYLE = /<(script|style)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi;

// The scan region is the whole file with <script>/<style> bodies (tags included)
// replaced by same-length spaces, so the OPEN_TAG scan can't see them while every
// surviving index still maps 1:1 onto the original source.
function markupRegion(code: string): ScanRegion {
  const scan = code.replace(SCRIPT_OR_STYLE, (m) => ' '.repeat(m.length));
  return { scan, offset: 0 };
}

/** Build the Svelte Stamper. `root` is the project root locs are made relative to. */
export function createSvelteStamper(root: string = process.cwd()): Stamper {
  return createHtmlGrammarStamper(
    root,
    // Only app .svelte source (strip any query); never node_modules.
    (id) => {
      const file = id.split('?')[0] ?? id;
      return file.endsWith('.svelte') && !file.includes('node_modules');
    },
    {
      openTag: OPEN_TAG,
      region: markupRegion,
      // Skip <svelte:*> special elements (compiler directives, no DOM output).
      skip: (tag) => tag.toLowerCase().startsWith('svelte:'),
    },
  );
}
