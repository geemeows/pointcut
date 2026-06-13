/* eslint-disable */
// Design Toolbar — copy / text inline-edit model (0007; see ../design-toolbar-plugin.js).
//
// The lowest-friction control (D6, ADR 0002): no tokens, no provenance — just
// the element's wording. Captures the original text as `before`, and on commit
// turns the edited text into a `copy` intent the agent applies at the source
// (a template literal or, if i18n-bound, the message catalog — that resolution
// is the agent's job, not ours). Pure model: it holds the before string and
// assembles the edit; the caller (client.js) reads/writes the live textContent
// and paints the throwaway inline preview. No dependencies.

export const createCopyModel = () => {
  // Open an edit session seeded with the element's current text.
  const begin = (before) => {
    const orig = (before == null ? '' : String(before)).trim();

    // Assemble the 0003 `copy` edit from the edited text. Returns null when the
    // wording is unchanged (selecting the element without editing attaches
    // nothing). Compared and stored trimmed — surrounding template whitespace
    // is the agent's concern, not part of the wording change.
    const toEdit = (after) => {
      const next = (after == null ? '' : String(after)).trim();
      if (next === orig) return null;
      return { type: 'copy', before: orig, after: next };
    };

    return { before: orig, toEdit };
  };

  return { begin };
};
