/* eslint-disable */
// Design Toolbar — typography stepper model (0006; see ../design-toolbar-plugin.js).
//
// The type control (D4, D6, D7, ADR 0002). Like the spacing stepper (0004) but
// across three facets — size, weight, line-height — each walking its own
// introspected scale (length-typed sizes, number-typed weights/line-heights via
// 0001, sub-grouped by optional prefix hints) so
// every value lands on a real token. The seed is snapped to the nearest token
// and badged off-scale when it isn't exact; a step lands exactly (off-scale
// clears). Unlike color, type carries no semantic role, so its edit rides the
// same legacy handoff path as spacing (`role:null`, no `kind`). Pure model: it
// computes the value at each step and assembles the 0003 `edit` record but never
// touches the DOM — the caller (client.js) reads the element's current value,
// paints the throwaway inline preview, and reads provenance (0002). `tokens` is
// the only dependency, injected for testing.

// Typography facets, named by the CSS property each drives. Designers see
// Size / Weight / Line height; the edit and agent see the CSS property.
// (Font-family is out of scope — only two families exist; D6.)
export const TYPOGRAPHY_PROPS = ['font-size', 'font-weight', 'line-height'];

export const createTypographyModel = ({ tokens }) => {
  // Each facet maps to its scale, its snapper, and how the current value is
  // formatted into the edit's `before`: size is px, weight an integer, and
  // line-height an unitless ratio (keep up to two decimals).
  const FACETS = {
    'font-size': {
      scale: () => tokens.fontSizeScale(),
      snap: (n) => tokens.snapFontSize(n),
      fmt: (n) => `${Math.round(n)}px`,
    },
    'font-weight': {
      scale: () => tokens.fontWeightScale(),
      snap: (n) => tokens.snapFontWeight(n),
      fmt: (n) => `${Math.round(n)}`,
    },
    'line-height': {
      scale: () => tokens.fontLineHeightScale(),
      snap: (n) => tokens.snapFontLineHeight(n),
      fmt: (n) => `${Math.round(n * 100) / 100}`,
    },
  };

  // Open a stepping session for one facet, seeded at the nearest token to the
  // element's current value. Returns null for an unknown property or an empty
  // scale (no tokens of that kind on :root).
  const begin = (property, currentValue) => {
    const facet = FACETS[property];
    if (!facet) return null;
    const scale = facet.scale();
    if (!scale.length) return null;

    const snap = facet.snap(currentValue);
    let index = snap ? scale.findIndex((t) => t.name === snap.name) : 0;
    if (index < 0) index = 0;
    // The original declared value, preserved for the edit's `before`. Stepping
    // never changes it — it's what the agent is asked to change *from*.
    const before = Number.isFinite(currentValue) ? facet.fmt(currentValue) : '';
    // Off-scale until the user steps: the seed is the nearest token, not exact.
    let offScale = snap ? snap.offScale : true;

    const current = () => {
      const t = scale[index];
      return { property, token: t.name, value: t.value, px: t.px, offScale };
    };

    // Move one token along the scale. Clamps at the ends. Any step lands the
    // inline preview exactly on a token, so off-scale no longer applies.
    const step = (dir) => {
      const next = index + (dir < 0 ? -1 : 1);
      if (next >= 0 && next < scale.length) {
        index = next;
        offScale = false;
      }
      return current();
    };

    // Assemble the 0003 `edit` record from the current step plus provenance
    // (read by the caller). `role` is null — typography carries no semantic role.
    const toEdit = (provenance) => {
      const c = current();
      return {
        property,
        before,
        after: { token: c.token, value: c.value, offScale: c.offScale },
        provenance: provenance || null,
        role: null,
      };
    };

    return { property, current, step, toEdit };
  };

  return { props: TYPOGRAPHY_PROPS, begin };
};
