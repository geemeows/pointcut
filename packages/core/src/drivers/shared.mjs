/* eslint-disable */
// Design Toolbar — shared Driver bits.
//
// A turn carries a `mode` = the tab's posture. It fixes two agent-agnostic things:
// the directive folded into the prompt, and (per Driver) the permission flag.
//
//   apply       — edit the source files directly (today's behavior; the default)
//   apply-once  — same edit posture, scoped to one turn (0010's Apply toggle)
//   discuss     — locate / explain / propose only; DO NOT edit any files
//
// The directive lives here because both halves of the apply/discuss split are
// prose, identical across Drivers. The permission flag is Driver-specific, so
// each Driver picks it from `isWriteMode(mode)`.

// Edit posture (apply + apply-once). Exported for back-compat with callers that
// imported it directly before mode plumbing existed.
export const APPLY_DIRECTIVE =
  'Apply these changes by editing the source files directly (the source:line:col ' +
  'on each item is the exact spot). Make the smallest edits that satisfy each ' +
  'request. Do not start the dev server or run tests.';

// Discuss posture: read-only. Locate and propose, but change nothing.
export const DISCUSS_DIRECTIVE =
  'Do not edit any files. For each item, locate the exact source (the ' +
  'source:line:col on each item is the spot), explain what you would change, and ' +
  'propose the edit — but make no changes. Do not start the dev server or run tests.';

// mode → directive. apply and apply-once share the edit directive; only the
// apply/discuss split changes the prompt.
const DIRECTIVES = {
  apply: APPLY_DIRECTIVE,
  'apply-once': APPLY_DIRECTIVE,
  discuss: DISCUSS_DIRECTIVE,
};

// The default when a turn omits `mode` — preserves today's edit behavior.
export const DEFAULT_MODE = 'apply';

// Resolve a (possibly absent/unknown) mode to its directive, defaulting to apply.
export const directiveForMode = (mode) => DIRECTIVES[mode] || APPLY_DIRECTIVE;

// Whether the mode may write files. discuss is the only read-only posture;
// anything else (including absent/unknown) defaults to the writing apply mode.
export const isWriteMode = (mode) => mode !== 'discuss';
