/* eslint-disable */
// Design Toolbar — Handoff markdown (see ../design-toolbar-plugin.js).
//
// Pure builders: turn Annotations into the paste-and-go markdown the toolbar
// hands to Claude (or copies / exports). No DOM, no live queue — the display
// number for each item is passed in, so the same builder serves "Copy all"
// (whole queue) and "Send to Claude" (a checked subset) while keeping the
// on-screen bubble numbers. The interface is the test surface.

export const HANDOFF_HEADER =
  'Design feedback — apply the following changes. Each item gives a type, ' +
  'source:line:col, the selected element, and a requested change.\n';

// Resolve an Annotation's type tag to its human label (falls back to the first).
const labelOf = (a, types) => (types.find((t) => t.id === a.type) || types[0]).label;

// One structured visual-tweak intent (a member of an Annotation's `edits[]`)
// rendered as explicit, unambiguous instructions: name the snapped token, point
// at where the style is defined, and tell the agent how small the edit must be.
// Vendor-owned styles get a prop/variant directive instead of a source edit, and
// off-scale snaps are flagged as needing a human decision (D3, D5, D9).
export const editBlock = (e) => {
  // Copy (0007): a pure wording change — no token, no provenance subtleties.
  // Point the agent at the rendered string; if it's i18n-bound, the catalog is
  // the real edit site, not the template literal (D6).
  if (e.type === 'copy') {
    return [
      `- **Edit copy:** "${e.before}" → "${e.after}"`,
      `  - **Update the rendered string at its source.** If the string is i18n-bound, edit the message catalog entry rather than the template literal.`,
    ].join('\n');
  }
  const token = `\`${e.after.token} / ${e.after.value}\``;
  const lines = [`- **Edit \`${e.property}\`:** \`${e.before}\` → token ${token}`];
  if (e.provenance && e.provenance.selector) {
    const kind = e.provenance.sourceKind ? ` _(${e.provenance.sourceKind})_` : '';
    lines.push(`  - **Defined at:** \`${e.provenance.selector}\`${kind}`);
  }
  // Color (0005): the picked value is a *primitive* — never write it at the
  // usage site. Swap the semantic role so dark mode stays correct (D5); if no
  // role applies, that gap is the deliverable to flag (D4/D8).
  if (e.kind === 'color') {
    if (e.role) {
      lines.push(`  - **Semantic role:** \`${e.role}\` currently applies.`);
      lines.push(
        `  - **Swap the role, not the primitive:** move \`${e.role}\` toward ${token} by switching to the semantic token whose value matches it. Keep dark mode correct — do not write the raw primitive at the usage site.`,
      );
    } else {
      lines.push(
        `  - **⚠ No semantic role applies** — this color isn't backed by a \`--surface\`/\`--text\`/\`--border\`/\`--icon\` token. A semantic role may need to be introduced before the swap; flag for design-system review rather than writing the primitive.`,
      );
    }
    if (e.provenance && e.provenance.sourceKind === 'vendor') {
      lines.push('  - **Vendor-owned — use a prop/variant change at the usage site.**');
      lines.push('  - **Do not edit node_modules.**');
    }
    return lines.join('\n');
  }
  if (e.role) lines.push(`  - **Semantic role:** \`${e.role}\``);
  if (e.after.offScale) {
    lines.push(`  - **⚠ No exact token:** nearest is ${token} — needs a decision.`);
  }
  if (e.provenance && e.provenance.sourceKind === 'vendor') {
    lines.push('  - **Vendor-owned — use a prop/variant change at the usage site.**');
    lines.push('  - **Do not edit node_modules.**');
  } else {
    lines.push(
      `  - **Smallest edit:** change only the \`${e.property}\` declaration at its source; leave other rules untouched.`,
    );
  }
  return lines.join('\n');
};

// One markdown block for a single Annotation, numbered `n`.
export const blockFor = (a, n, types) => {
  const lines = [
    `### ${n}. [${labelOf(a, types)}] ${a.label}`,
    `- **Source:** \`${a.loc || 'unknown'}\``,
    `- **Change:** ${a.comment}`,
  ];
  if (a.edits && a.edits.length) a.edits.forEach((e) => lines.push(editBlock(e)));
  if (a.outerHTML) lines.push('- **Element:**', '```html', a.outerHTML, '```');
  return lines.join('\n');
};

// Full handoff for a list of Annotations. `numberOf(a)` returns each item's
// display number (caller keeps it aligned with the on-screen bubbles).
export const buildHandoff = (annotations, numberOf, types) =>
  [HANDOFF_HEADER, ...annotations.map((a) => blockFor(a, numberOf(a), types))].join('\n\n');

// ---- Context chips (0011) --------------------------------------------------
// A chat turn can carry read-only element references picked while the Chat tab
// was active (D13). Unlike an annotation these request no change — they tell the
// agent *which* on-page elements the user is discussing, with the same locator /
// provenance signals (0002) so the agent can find and reason about them.

export const CONTEXT_HEADER =
  'Context — the following on-page elements are attached to this message as ' +
  'read-only references for discussion (not a change request).\n';

// One chip rendered as a compact reference block, numbered `n`.
export const chipBlock = (c, n) => {
  const classes = (c.classList || []).join(' ');
  const lines = [
    `### ${n}. ${c.label || c.tag || 'element'}`,
    `- **Source:** \`${c.loc || 'unknown'}\``,
    `- **Element:** \`<${c.tag || 'element'}>\`${classes ? ` · classes: \`${classes}\`` : ''}`,
  ];
  const p = c.provenance;
  if (p && p.selector) {
    const kind = p.sourceKind ? ` _(${p.sourceKind})_` : '';
    lines.push(`- **Style source:** \`${p.selector}\`${kind}`);
  }
  if (p && p.sourceKind === 'vendor') {
    lines.push('- **Vendor-owned** — discuss a prop/variant change at the usage site; do not edit node_modules.');
  }
  return lines.join('\n');
};

// Full context section for a turn's chips, numbered from 1.
export const contextChipsBlock = (chips) =>
  [CONTEXT_HEADER, ...chips.map((c, i) => chipBlock(c, i + 1))].join('\n\n');
