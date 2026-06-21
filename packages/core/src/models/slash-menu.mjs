/* eslint-disable */
// Slash skill-menu — pure decision logic, lifted from the client (issue #1).
//
// The "/" menu lets you complete a project Skill/command into the chat composer.
// The DECISIONS — where the caret's slash-token sits, which Skills match a query
// and in what order, where the selection lands after ↑/↓, and what the composer
// text becomes after a pick — are all pure string/array math with no DOM.
//
// The client keeps the DOM glue: reading `selectionStart`/`value` off the
// textarea, rendering the option list (innerHTML + `markName` highlighting),
// scrolling the active row into view, and writing the value back. Those call
// into the functions below.

// The slash-token under the caret, if the caret is within the leading run of
// "/token" tokens. Pure: takes the composer string + caret index (not a DOM
// node). Returns { query, start } or null.
//   value  — the full composer text
//   caret  — caret offset; pass value.length when there's no live selection
export const slashContext = (value, caret) => {
  const head = String(value).slice(0, caret);
  const m = head.match(/^((?:\/[A-Za-z0-9][\w-]*\s+)*)\/([A-Za-z0-9][\w-]*)?$/);
  return m ? { query: m[2] || '', start: m[1].length } : null;
};

// Filter + rank skills by a query: substring match (case-insensitive), then
// prefix matches sorted ahead of mid-string matches. Stable for equal ranks.
export const filterSkills = (skills, query) => {
  const ql = String(query).toLowerCase();
  return skills
    .filter((s) => s.name.toLowerCase().includes(ql))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(ql)) - Number(a.name.toLowerCase().startsWith(ql)));
};

// Move the highlighted row by `dir` (+1 down, -1 up) within `len` options,
// wrapping at both ends. Returns the new active index. `len <= 0` → 0.
export const moveSelection = (active, len, dir) => {
  if (len <= 0) return 0;
  return ((active + dir) % len + len) % len;
};

// Clamp an active index that may now point past the end of a shrunk list.
export const clampActive = (active, len) => (active >= len ? 0 : active);

// Compute the composer text + caret after picking a skill. Inserts "/name " at
// `tokenStart`, replacing the in-progress token up to `caret`. Pure: returns the
// new { value, caret }; the client writes them back onto the textarea.
export const applyPick = (value, caret, tokenStart, name) => {
  const v = String(value);
  const insert = '/' + name + ' ';
  const nextValue = v.slice(0, tokenStart) + insert + v.slice(caret);
  return { value: nextValue, caret: tokenStart + insert.length };
};
