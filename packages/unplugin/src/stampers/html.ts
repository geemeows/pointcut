// Plain HTML Source Stamp — the .html implementation of the Stamper interface.
//
// Plain HTML is an HTML-grammar, so it reuses the shared scan + magic-string
// engine (see ./html-grammar.ts), minus the SFC <template> block extraction:
// there is no wrapper to peel, so we scan opening element tags across the whole
// document. It writes `data-pointcut-loc="file:line:col"` onto each rendered
// one, idempotently, emitting a real source map so a clicked DOM node resolves
// back to its spot in source.
//
// We stamp DOM-output element tags only and skip the document scaffolding /
// non-rendered tags (html/head/meta/title/link/base/script/style) — stamping
// those is harmless but adds noise to no DOM node. `<!doctype ...>` and comments
// never match OPEN_TAG, so they fall away for free, and script/style *contents*
// are left untouched: any '<' inside a raw-text body is literal text (e.g. a JS
// string `"<div>"`), so we collect those [start,end) ranges and never stamp a
// tag falling inside one.
import type { Stamper } from '../index';
import { createHtmlGrammarStamper, type ScanRegion } from './html-grammar';

// Re-export the contract attribute name so test/consumer imports of LOC_ATTR
// from this module keep working; the single source of truth lives in core.
export { LOC_ATTR } from '@pointcut/core';

// Match a single opening tag, tolerating attribute values that contain '>'
// by consuming quoted strings whole. Captures: 1=tag name, 2=attrs, 3=self-close.
const OPEN_TAG = /<([a-zA-Z][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

// Document scaffolding / non-rendered tags: present in HTML but back no DOM
// node a user would pick.
const SKIP_TAGS = new Set(['html', 'head', 'meta', 'title', 'link', 'base', 'script', 'style']);

// Raw-text element bodies whose contents are *not* HTML — any '<' inside is
// literal text. We collect their [start,end) byte ranges so OPEN_TAG matches
// falling inside them are never stamped.
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

/** Build the HTML Stamper. `root` is the project root locs are made relative to. */
export function createHtmlStamper(root: string = process.cwd()): Stamper {
  // Raw-text ranges are computed once per `code` and reused across every skip()
  // call in that transform (the engine drives one transform at a time).
  let cachedCode: string | null = null;
  let cachedRanges: Array<[number, number]> = [];
  const rangesFor = (code: string): Array<[number, number]> => {
    if (cachedCode !== code) {
      cachedCode = code;
      cachedRanges = rawTextRanges(code);
    }
    return cachedRanges;
  };

  return createHtmlGrammarStamper(
    root,
    // Only app .html source (strip any query); never node_modules.
    (id) => {
      const file = id.split('?')[0] ?? id;
      return file.endsWith('.html') && !file.includes('node_modules');
    },
    {
      openTag: OPEN_TAG,
      // No wrapper to peel — scan the whole document.
      region: (code): ScanRegion => ({ scan: code, offset: 0 }),
      // Skip non-rendered scaffolding tags and any '<' inside a raw-text body.
      skip: (tag, tagStart, code) =>
        SKIP_TAGS.has(tag.toLowerCase()) ||
        rangesFor(code).some(([lo, hi]) => tagStart >= lo && tagStart < hi),
    },
  );
}
