/* eslint-disable */
// loc — the Source Stamp wire-format contract, in one place.
//
// The Source Stamp (the unplugin's compile-time transform) and the client's
// Locator are the two halves of Pointcut's single most important coupling point
// (CONTEXT.md: "the Source Stamp and the Bridge are the only two coupling
// points"). The stamp the transform WRITES and the value the Locator READS must
// agree byte-for-byte, yet the attribute name and the `file:line:col` string
// used to be hand-built and hand-parsed in five different files. This module
// owns all three: the attribute name, how a loc is encoded, and how it is
// decoded — so the wire format can only ever change in one spot.
//
// Browser-safe and framework-free on purpose: it is imported by the build-time
// stampers (Node) AND by the in-page client/Locator (browser), so it must pull
// in nothing Node- or DOM-specific.

/** The neutral Source Stamp attribute. Written by the stampers, read by the Locator. */
export const LOC_ATTR = 'data-pointcut-loc';

/**
 * Encode a source location into the wire string `"file:line:col"`.
 *
 * `file` is whatever the stamper computed (a project-relative path), `line` and
 * `col` are 1-based. The path is placed first and may itself contain ':'
 * (e.g. a Windows drive letter) — `decodeLoc` recovers it by splitting off the
 * trailing two numeric segments, so encode/decode round-trips regardless.
 *
 * @param {{ file: string, line: number, col: number }} loc
 * @returns {string}
 */
export const encodeLoc = ({ file, line, col }) => `${file}:${line}:${col}`;

/**
 * Decode a `"file:line:col"` wire string back into its parts, or null if the
 * string is not a well-formed loc (missing the two trailing numeric segments).
 *
 * Splits from the RIGHT: the last two colon-separated segments are line and col,
 * everything before them is the file path. This preserves paths that themselves
 * contain ':' (Windows `C:\...`, or a query-ish segment) without a custom escape.
 *
 * @param {string} str
 * @returns {{ file: string, line: number, col: number } | null}
 */
export const decodeLoc = (str) => {
  if (typeof str !== 'string') return null;
  const lastColon = str.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const prevColon = str.lastIndexOf(':', lastColon - 1);
  if (prevColon <= 0) return null;

  const file = str.slice(0, prevColon);
  const lineStr = str.slice(prevColon + 1, lastColon);
  const colStr = str.slice(lastColon + 1);
  if (!/^\d+$/.test(lineStr) || !/^\d+$/.test(colStr)) return null;

  return { file, line: Number(lineStr), col: Number(colStr) };
};
