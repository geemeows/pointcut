/* eslint-disable */
// Design Toolbar — color picker model (0005; see ../design-toolbar-plugin.js).
//
// Color is where vocabulary matters (D5). Designers think in a primitive ramp —
// the Figma mental model — so the control shows the project's raw color swatches
// (the color ramp introspected in 0001). But shipping a primitive at the usage
// site can break theming (dark mode): the edit should land on the *semantic*
// token the element already references, not a raw value. So this model captures
// intent as "the element's <current role> should move toward <picked primitive>"
// and the agent swaps to the semantic token whose value matches. The current
// role is read from where the property is actually defined (provenance, 0002) —
// roleOf() extracts whichever `var(--token)` the declared value references,
// design-system-agnostically (no hardcoded role-name vocabulary, ADR 0001). A
// reference that resolves to a swatch in the primitive ramp is treated as a raw
// primitive, not a role. No role applying is itself signal (D4/D8): the intent is
// flagged as possibly needing a semantic token rather than silently writing a
// hex. Pure model: it picks among tokens and assembles the 0003 `edit` record but
// never touches the DOM — the caller (client.js) reads the computed color, paints
// the throwaway inline preview, and reads provenance. `tokens` is the only
// dependency, injected for testing.

// Color facets the control offers, mapped to the CSS property each drives.
// Designers see Fill / Text / Border; the edit and agent see the CSS property.
export const COLOR_PROPS = ['background-color', 'color', 'border-color'];

export const createColorModel = ({ tokens }) => {
  // Extract the semantic role token referenced in a declared value, e.g.
  // 'var(--surface-brand-default)' → '--surface-brand-default'. The role is
  // whatever custom property the value references — Pointcut does not assume a
  // design system's role-name vocabulary (ADR 0001). A reference that names a
  // swatch in the introspected primitive ramp is a raw primitive, not a role,
  // so it yields null. Raw colors (hex/rgb) also yield null → the intent is
  // flagged as having no semantic role (may need one introduced before the swap
  // is safe).
  const roleOf = (declaredValue) => {
    const m = /var\(\s*(--[\w-]+)/.exec(String(declaredValue || ''));
    if (!m) return null;
    const ref = m[1];
    const isPrimitive = tokens.colorRamp().some((s) => s.name === ref);
    return isPrimitive ? null : ref;
  };

  // Open a picking session for one property. `before` is the element's current
  // declared color (for the edit's before); `role` is the semantic token that
  // currently applies, or null when none does. Returns null when the ramp is
  // empty. No swatch is picked until pick() is called — current() is null and
  // no edit will be attached, mirroring spacing's "select without stepping".
  const begin = (property, before, role) => {
    const swatches = tokens.colorRamp();
    if (!swatches.length) return null;
    let picked = null;

    const current = () => picked;

    const pick = (name) => {
      const next = swatches.find((s) => s.name === name);
      if (next) picked = next;
      return picked;
    };

    // Assemble the 0003 `edit` record. `after` names the picked primitive (an
    // exact pick, never off-scale); `role` carries the current semantic role;
    // `kind:'color'` lets handoff.mjs render the role-swap directive instead of
    // the spacing smallest-edit one. Returns null when nothing was picked.
    const toEdit = (provenance) => {
      if (!picked) return null;
      return {
        kind: 'color',
        property,
        before: before || '',
        after: { token: picked.name, value: picked.value, offScale: false },
        provenance: provenance || null,
        role: role || null,
      };
    };

    return { property, role: role || null, swatches, current, pick, toEdit };
  };

  return { props: COLOR_PROPS, roleOf, begin };
};
