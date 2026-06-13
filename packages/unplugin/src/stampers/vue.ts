// Vue Source Stamp — the .vue SFC implementation of the Stamper interface.
//
// Lifted from the source toolbar's hand-rolled SFC transform (see CONTEXT.md,
// docs/adr/0001), name-neutralized (`data-luciq-loc` → `data-pointcut-loc`) and
// refactored to route through `magic-string` so it emits a real source map
// instead of `map: null`. It stamps `data-pointcut-loc="file:line:col"` onto
// every opening element tag inside a .vue <template> block, so a clicked DOM
// node resolves back to its exact spot in source at pick time.
//
// MUST run before the Vue compiler turns the template into render code, so the
// owning unplugin sets `enforce: 'pre'` and we operate on raw .vue source — the
// line:col we compute then matches the real file. A stamp on a component usage
// (<MyButton>) marks the *usage* site, not the child's internals (intentional —
// that's the spot to edit).
import path from 'node:path';
import MagicString from 'magic-string';
import type { Stamper } from '../index';

/** The neutral Source Stamp attribute. Mirrored by the client's Locator. */
export const LOC_ATTR = 'data-pointcut-loc';

// Match a single opening tag, tolerating attribute values that contain '>'
// by consuming quoted strings whole. Captures: 1=tag name, 2=attrs, 3=self-close.
const OPEN_TAG = /<([a-zA-Z][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

// Locate the first <template ...> ... </template> (top-level SFC block).
const TEMPLATE_BLOCK = /<template(?:\s[^>]*)?>([\s\S]*?)<\/template>/;

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

/** Build the Vue Stamper. `root` is the project root locs are made relative to. */
export function createVueStamper(root: string = process.cwd()): Stamper {
  return {
    // Only app .vue source (strip any query); never node_modules.
    test(id) {
      const file = id.split('?')[0] ?? id;
      return file.endsWith('.vue') && !file.includes('node_modules');
    },

    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      const block = TEMPLATE_BLOCK.exec(code);
      if (!block) return null;

      const inner = block[1] ?? '';
      // Offset of the template's inner content within the whole file.
      const innerStart = block.index + block[0].indexOf(inner);
      const rel = path.relative(root, file);

      const s = new MagicString(code);
      let stamped = 0;

      OPEN_TAG.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = OPEN_TAG.exec(inner)) !== null) {
        const tag = match[1] ?? '';
        const attrs = match[2] ?? '';
        // Idempotency / skip the SFC's own <template> wrappers (no DOM output).
        if (tag.toLowerCase() === 'template' || ALREADY_STAMPED.test(attrs)) {
          continue;
        }
        // Absolute index of this tag's '<' within the whole file.
        const tagStart = innerStart + match.index;
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
