// Svelte Source Stamp — the .svelte implementation of the Stamper interface.
//
// Svelte markup is HTML-grammar, so this reuses the exact string + `magic-string`
// engine and OPEN_TAG approach as the Vue Stamper (see ./vue.ts), name-neutral
// throughout (`data-pointcut-loc`). It stamps `data-pointcut-loc="file:line:col"`
// onto every opening element tag in a .svelte file, so a clicked DOM node
// resolves back to its exact spot in source at pick time.
//
// Unlike a .vue SFC, a .svelte file has no <template> wrapper — the markup *is*
// the file, minus its <script> and <style> blocks. So instead of locating a
// template block, we carve those non-DOM regions out and only stamp the markup
// that remains. Svelte logic blocks ({#if}/{#each}) aren't element tags, so the
// OPEN_TAG regex skips them for free; the one markup tag we must NOT stamp is a
// <svelte:*> special element (<svelte:head>, <svelte:component>, …) — those are
// compiler directives, not DOM. Component usages (<MyButton>) follow the Vue
// rule: stamp the *usage* site, the spot to edit.
//
// MUST run before the Svelte compiler turns markup into render code, so the
// owning unplugin sets `enforce: 'pre'` and we operate on raw .svelte source —
// the line:col we compute then matches the real file.
import path from 'node:path';
import MagicString from 'magic-string';
import type { Stamper } from '../index';

/** The neutral Source Stamp attribute. Mirrored by the client's Locator. */
export const LOC_ATTR = 'data-pointcut-loc';

// Match a single opening tag, tolerating attribute values that contain '>'
// by consuming quoted strings whole. Captures: 1=tag name, 2=attrs, 3=self-close.
const OPEN_TAG = /<([a-zA-Z][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

// Top-level non-DOM blocks: <script> and <style>. Their bodies are JS/CSS, never
// markup, so we blank them out before stamping (keeping length/offsets intact).
const SCRIPT_OR_STYLE = /<(script|style)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi;

// Already-stamped guard, used for idempotency on a single tag's attrs.
const ALREADY_STAMPED = new RegExp(`\\b${LOC_ATTR}\\b`);

function lineColAt(source: string, index: number): { line: number; col: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) {
      line++;
      lastNewline = i;
    }
  }
  return { line, col: index - lastNewline };
}

// Replace <script>/<style> bodies (tags included) with same-length spaces so the
// OPEN_TAG scan can't see them, while every surviving index still maps 1:1 onto
// the original source for line:col + magic-string insertion.
function maskNonDom(code: string): string {
  return code.replace(SCRIPT_OR_STYLE, (m) => ' '.repeat(m.length));
}

/** Build the Svelte Stamper. `root` is the project root locs are made relative to. */
export function createSvelteStamper(root: string = process.cwd()): Stamper {
  return {
    // Only app .svelte source (strip any query); never node_modules.
    test(id) {
      const file = id.split('?')[0] ?? id;
      return file.endsWith('.svelte') && !file.includes('node_modules');
    },

    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      // Scan over a masked copy (script/style blanked) but stamp the real source.
      const scan = maskNonDom(code);
      const rel = path.relative(root, file);

      const s = new MagicString(code);
      let stamped = 0;

      OPEN_TAG.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = OPEN_TAG.exec(scan)) !== null) {
        const tag = match[1] ?? '';
        const attrs = match[2] ?? '';
        // Idempotency, and skip <svelte:*> special elements (no DOM output).
        if (tag.toLowerCase().startsWith('svelte:') || ALREADY_STAMPED.test(attrs)) {
          continue;
        }
        // Absolute index of this tag's '<' within the whole file (scan and code
        // share offsets — masking preserves length).
        const tagStart = match.index;
        const { line, col } = lineColAt(code, tagStart);
        const loc = `${rel}:${line}:${col}`;
        // Insert the attribute right after the existing attrs, before the
        // closing '/>' or '>' — magic-string tracks it in the emitted map.
        const insertAt = tagStart + 1 + tag.length + attrs.length;
        s.appendLeft(insertAt, ` ${LOC_ATTR}="${loc}"`);
        stamped++;
      }

      if (!stamped) return null; // nothing stamped — leave the module untouched

      return {
        code: s.toString(),
        map: s.generateMap({ source: id, includeContent: true, hires: true }),
      };
    },
  };
}
