/* eslint-disable */
// Design Toolbar — spacing stepper model (0004; see ../design-toolbar-plugin.js).
//
// The first visual control (D3, D6, ADR 0002). Turns an element's current
// spacing into a stepper that moves through the live --spacing-* scale (0001),
// so every value the user lands on names a real token. The starting value is
// snapped to the nearest token and badged off-scale when it isn't an exact
// match; stepping always lands exactly on a token (off-scale clears). Pure
// model: it computes the value at each step and assembles the structured `edit`
// record (the 0003 contract) but never touches the DOM — the caller (client.js)
// reads the element's current px, paints the throwaway inline preview, and reads
// provenance (0002). `tokens` is the only dependency, injected for testing.

// Spacing properties the control offers. padding/margin set all sides; gap the
// flex/grid gap. Stepping is uniform (one number), which is the tracer scope.
export const SPACING_PROPS = ['padding', 'margin', 'gap'];

export const createSpacingModel = ({ tokens }) => {
  // Open a stepping session for one property, seeded at the nearest token to
  // the element's current px. Returns null when there are no spacing tokens.
  const begin = (property, currentPx) => {
    const scale = tokens.spacingScale();
    if (!scale.length) return null;

    const snap = tokens.snapSpacing(currentPx);
    let index = snap ? scale.findIndex((t) => t.name === snap.name) : 0;
    if (index < 0) index = 0;
    // The original declared value, preserved for the edit's `before`. Stepping
    // never changes it — it's what the agent is asked to change *from*.
    const before = Number.isFinite(currentPx) ? `${Math.round(currentPx)}px` : '';
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
    // (read by the caller). `role` is null — spacing carries no semantic role.
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

  return { props: SPACING_PROPS, begin };
};
