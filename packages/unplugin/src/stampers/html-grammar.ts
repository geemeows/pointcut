// Shared HTML-grammar Source Stamp engine.
//
// Three of the four stampers — Vue (.vue <template>), Svelte (.svelte markup),
// and plain HTML — are HTML-grammar: their markup is real angle-bracket tags, so
// they can be stamped with a string scan + magic-string rather than a full AST
// parse (only JSX needs Babel, see ./jsx.ts). They shared ~70% verbatim code:
// the `lineColAt` helper, the open-tag regex, the already-stamped idempotency
// guard, and the magic-string append loop + sourcemap generation. This module
// owns all of that once; each stamper supplies only the two things that actually
// differ:
//   (a) which region of the file to scan — Vue scans inside <template>; Svelte
//       scans a masked copy with <script>/<style> blanked; HTML scans the whole
//       file. A region is expressed as a SCAN string the same length as `code`
//       plus a base offset into the original (so every match index maps 1:1 back
//       onto the real source for line:col and insertion).
//   (b) which tags to skip — Vue skips its <template> wrapper, Svelte skips
//       <svelte:*> directives, HTML skips scaffolding tags + raw-text ranges.
import path from 'node:path';
import MagicString from 'magic-string';
import { LOC_ATTR, encodeLoc } from '@pointcut/core';
import type { Stamper } from '../index';

// Already-stamped guard: detect the loc attribute already on a tag's attrs so a
// second pass is a no-op. Built from the contract attribute name.
const ALREADY_STAMPED = new RegExp(`\\b${LOC_ATTR}\\b`);

/** 1-based line, 1-based column (column counted after the leading newline). */
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

/** A scan window into the file: a same-length string and its offset in `code`. */
export interface ScanRegion {
  /** The text to run the open-tag regex over — must be the SAME length-mapping as
   *  the slice of `code` it represents, so a match index + `offset` lands on the
   *  real '<' in the original source. */
  scan: string;
  /** Where `scan` begins within the whole `code` (0 for whole-file scans). */
  offset: number;
}

export interface HtmlGrammarConfig {
  /**
   * The open-tag regex. Captures: 1=tag name, 2=attrs, 3=self-close marker.
   * Differs only in the tag-name character class (Svelte allows ':' for
   * <svelte:*>; Vue/HTML do not). `g` flag required — the engine drives it.
   */
  openTag: RegExp;
  /**
   * Pick the region(s) to scan. Returning `null` means "nothing to stamp"
   * (e.g. a .vue file with no <template>) and the transform short-circuits.
   * Returns one region today; the shape leaves room for several if ever needed.
   */
  region(code: string): ScanRegion | null;
  /**
   * True ⇒ do NOT stamp this tag (wrapper/directive/scaffolding/raw-text). The
   * idempotency check is handled by the engine; this is purely the per-grammar
   * skip rule. `tagStart` is the absolute index of '<' in the original `code`.
   */
  skip(tag: string, tagStart: number, code: string): boolean;
}

/**
 * Run the shared HTML-grammar stamp over `code`, inserting
 * `data-pointcut-loc="file:line:col"` on every non-skipped, not-yet-stamped
 * opening tag. Returns the rewritten code + sourcemap, or null when nothing was
 * stamped (so the unplugin leaves the module untouched).
 */
export function stampHtmlGrammar(
  code: string,
  id: string,
  root: string,
  config: HtmlGrammarConfig,
): { code: string; map: unknown } | null {
  const file = id.split('?')[0] ?? id;
  const region = config.region(code);
  if (!region) return null;

  const rel = path.relative(root, file);
  const { scan, offset } = region;

  const s = new MagicString(code);
  let stamped = 0;

  config.openTag.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = config.openTag.exec(scan)) !== null) {
    const tag = match[1] ?? '';
    const attrs = match[2] ?? '';
    // Absolute index of this tag's '<' within the whole original file.
    const tagStart = offset + match.index;
    // Idempotency (engine-owned) + the grammar's own skip rule.
    if (ALREADY_STAMPED.test(attrs) || config.skip(tag, tagStart, code)) continue;

    const { line, col } = lineColAt(code, tagStart);
    const loc = encodeLoc({ file: rel, line, col });
    // Insert right after the existing attrs, before the closing '/>' or '>' —
    // magic-string tracks it in the emitted map.
    const insertAt = tagStart + 1 + tag.length + attrs.length;
    s.appendLeft(insertAt, ` ${LOC_ATTR}="${loc}"`);
    stamped++;
  }

  if (!stamped) return null;

  return {
    code: s.toString(),
    map: s.generateMap({ source: id, includeContent: true, hires: true }),
  };
}

/**
 * Assemble a full Stamper from a file-extension `test` and an HTML-grammar
 * config — the entire body of the Vue/Svelte/HTML stampers minus their per-
 * grammar rules. `root` is the project root locs are made relative to.
 */
export function createHtmlGrammarStamper(
  root: string,
  test: Stamper['test'],
  config: HtmlGrammarConfig,
): Stamper {
  return {
    test,
    transform: (code, id) => stampHtmlGrammar(code, id, root, config),
  };
}
