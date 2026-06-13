// Plain HTML Source Stamp — the .html implementation of the Stamper interface.
//
// Plain HTML is an HTML-grammar, so it reuses the same string + magic-string
// engine and OPEN_TAG approach as the Vue stamper (see ./vue.ts), minus the
// SFC <template> block extraction: there is no wrapper to peel, so we stamp
// opening element tags across the whole document. It writes
// `data-pointcut-loc="file:line:col"` onto each one, idempotently, emitting a
// real source map so a clicked DOM node resolves back to its spot in source.
//
// We stamp DOM-output element tags only and skip the document scaffolding /
// non-rendered tags (html/head/meta/title/link/base/script/style) in the spirit
// of the Vue stamper — stamping those is harmless but adds noise to no DOM node.
// `<!doctype ...>` and comments never match OPEN_TAG, so they fall away for free,
// and script/style *contents* are left untouched (we only ever rewrite an
// opening tag's attribute list, never the text between tags).
import path from 'node:path';
import MagicString from 'magic-string';
import type { Stamper } from '../index';

/** The neutral Source Stamp attribute. Mirrored by the client's Locator. */
export const LOC_ATTR = 'data-pointcut-loc';

// Match a single opening tag, tolerating attribute values that contain '>'
// by consuming quoted strings whole. Captures: 1=tag name, 2=attrs, 3=self-close.
const OPEN_TAG = /<([a-zA-Z][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

// Already-stamped guard, used for idempotency on a single tag's attrs.
const ALREADY_STAMPED = new RegExp(`\\b${LOC_ATTR}\\b`);

// Document scaffolding / non-rendered tags: present in HTML but back no DOM
// node a user would pick. Skipped per the Vue stamper's spirit.
const SKIP_TAGS = new Set(['html', 'head', 'meta', 'title', 'link', 'base', 'script', 'style']);

// Raw-text element bodies whose contents are *not* HTML — any '<' inside is
// literal text (e.g. a JS string `"<div>"`). We collect their [start,end) byte
// ranges so OPEN_TAG matches falling inside them are never stamped.
const RAW_TEXT_BLOCK = /<(script|style)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;

function rawTextRanges(code: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  RAW_TEXT_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RAW_TEXT_BLOCK.exec(code)) !== null) {
    const body = m[2] ?? '';
    const bodyStart = m.index + m[0].indexOf(body, m[1]!.length);
    ranges.push([bodyStart, bodyStart + body.length]);
  }
  return ranges;
}

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

/** Build the HTML Stamper. `root` is the project root locs are made relative to. */
export function createHtmlStamper(root: string = process.cwd()): Stamper {
  return {
    // Only app .html source (strip any query); never node_modules.
    test(id) {
      const file = id.split('?')[0] ?? id;
      return file.endsWith('.html') && !file.includes('node_modules');
    },

    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      const rel = path.relative(root, file);

      const s = new MagicString(code);
      const skipRanges = rawTextRanges(code);
      let stamped = 0;

      OPEN_TAG.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = OPEN_TAG.exec(code)) !== null) {
        const tag = match[1] ?? '';
        const attrs = match[2] ?? '';
        // Absolute index of this tag's '<' within the whole file.
        const tagStart = match.index;
        // Idempotency + skip the non-rendered scaffolding tags + any '<' that
        // lives inside a <script>/<style> body (it's literal text, not a tag).
        if (
          SKIP_TAGS.has(tag.toLowerCase()) ||
          ALREADY_STAMPED.test(attrs) ||
          skipRanges.some(([lo, hi]) => tagStart >= lo && tagStart < hi)
        ) {
          continue;
        }
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
