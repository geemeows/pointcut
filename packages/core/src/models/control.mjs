/* eslint-disable */
// Design Toolbar — inspector control factory (0004–0007; see ./spacing.mjs,
// ./color.mjs, ./typography.mjs, ./copy.mjs).
//
// The four contextual controls in the note box — Spacing, Color, Typography,
// Copy — were four near-duplicate clusters of closure helpers in client.js
// (select/step/pick + preview/restore/reset + a slice of commitNote). They
// differ only in: which underlying model they wrap, which DOM target they
// preview onto (a CSS property via setProperty, or textContent for copy), how
// the current step is rendered, and WHEN provenance is captured. This factory
// collapses them into ONE parameterised `createControl(config)`; each instance
// OWNS its active-session state, replacing the closure `let`s spacing/color/
// type/copy. It WRAPS the injected model — it never re-implements token math.
//
// What stays the CLIENT's job (kept out of this model so it stays DOM-free and
// testable, mirroring provenance's injected `doc`):
//   - The real DOM touch. The client injects an `io` adapter:
//       io.read(el, property)            → current value the model seeds from
//                                          (computed px / declared color / text)
//       io.write(el, target, value)      → paint the throwaway inline preview
//       io.clear(el, target)             → remove an inline override
//       io.provenance(el, property)      → a provenance.inspect() result
//     `target` is the previewTarget below: a CSS property name, or the literal
//     'textContent'. The model decides WHAT to write and WHEN; the io does the
//     write. No document/window/getComputedStyle lives here.
//   - Painting the render data. select()/step()/pick() return a `render`
//     descriptor (a tagged plain object — readout strings, swatch list, active
//     token); the client paints it into its nodes. The model emits data, never
//     innerHTML against live nodes.
//
// Capture timing is EXPLICIT per config (preserving the current asymmetry):
//   - color: captureAt:'select' — provenance is read in select(), BEFORE the
//     live preview pollutes the declared value (0002 checks inline first), and
//     stashed on the session for commit().
//   - spacing/type: captureAt:'commit' — provenance is read in commit(), after
//     the preview has been restored.
//   - copy: captureAt:'none' — no provenance at all.
//
// config:
//   {
//     model,                 // the wrapped model: { begin, roleOf?, props? }
//     previewTarget,         // CSS property string, OR 'textContent' (copy)
//     captureAt,             // 'select' | 'commit' | 'none'
//     renderStrategy,        // 'stepper' | 'colorRamp' | 'freeText'
//     // how the model is opened — each config supplies a tiny seed adapter so
//     // the factory never special-cases a model's begin() arity:
//     beginSession(io, el, property) → session | null
//     // copy is degenerate: free-text value, textContent preview, no step/pick.
//     freeText,              // boolean — true only for copy
//   }
//
// Instance API (every method is a no-op-safe call; degenerate copy implements
// arm/preview/restore/reset/capture/commit and leaves select/step/pick inert):
//   ctl.session                       → the active session, or null
//   ctl.select(el, property)          → { active, render } | { active:false }
//   ctl.step(dir)                     → { render } | null
//   ctl.pick(token)                   → { render } | null
//   ctl.arm(el)                       → { value } (copy only; seeds field)
//   ctl.preview(value)                → void (writes the throwaway preview)
//   ctl.restore()                     → void (undo preview to origInline)
//   ctl.reset()                       → void (drop session)
//   ctl.commit()                      → an `edit` record, or null
//   ctl.isActive()                    → boolean
//   ctl.previewTarget                 → the config's previewTarget (for the client)

// A render descriptor is a plain tagged object the client paints. Shapes:
//   stepper:   { strategy:'stepper', token, value, offScale }
//   colorRamp: { strategy:'colorRamp', role, swatches:[{name,value}], active }
//   freeText:  { strategy:'freeText', value }
const stepperRender = (c) => ({
  strategy: 'stepper',
  token: c.token,
  value: c.value,
  offScale: !!c.offScale,
});

const colorRoleRamp = (session, active) => ({
  strategy: 'colorRamp',
  role: session.role || null,
  swatches: session.swatches.map((s) => ({ name: s.name, value: s.value })),
  active: active || null,
});

export const createControl = (config) => {
  const { model, previewTarget, captureAt, renderStrategy, beginSession, freeText } = config;

  // Each control instance owns its one active session (or null). The shape
  // mirrors the old closure `let`s: { session, property, el, origInline, prov,
  // before }. `prov` is only set when captureAt === 'select'; `before` only for
  // free-text (copy).
  let active = null;

  const isActive = () => !!active;

  // The DOM target to write to. For copy it's the 'textContent' sentinel from
  // config; for the CSS controls (spacing/color/type) a single control handles
  // SEVERAL properties (padding/margin/gap, fill/text/border, …), so the target
  // is the ACTIVE property, not a fixed config string. previewTarget therefore
  // means "the textContent sentinel vs. use-the-selected-property".
  const targetOf = () => (freeText ? previewTarget : active.property);

  // Throwaway inline preview. For a CSS property the client's io.write does the
  // setProperty (precedence beats scoped CSS, D7); for copy, target is
  // 'textContent' and io.write swaps the element's text.
  const preview = (value) => {
    if (!active || !active.el || !active.io) return;
    active.io.write(active.el, targetOf(), value);
  };

  // Undo the preview, returning the element to its original inline value (or
  // removing the inline override when there wasn't one). Free-text restores its
  // captured `before` text instead of an inline property.
  const restore = () => {
    if (!active || !active.el || !active.io) return;
    if (freeText) {
      active.io.write(active.el, previewTarget, active.before);
      return;
    }
    if (active.origInline) active.io.write(active.el, targetOf(), active.origInline);
    else active.io.clear(active.el, targetOf());
  };

  // Drop the active session. The client clears its own UI (readout, .active
  // classes) from the fact that isActive() is now false.
  const reset = () => {
    active = null;
  };

  // ---- Stepper / ramp controls (spacing, color, type) ----------------------
  // Begin (or toggle off) a session for one property on the picked element.
  // Re-selecting the active property clears it (restore + reset) and returns
  // { active:false } so the client knows to collapse. captureAt:'select' reads
  // provenance here, before any preview lands.
  const select = (el, property, io) => {
    if (freeText) return { active: false };
    // Re-clicking the active property clears it (no edit will be attached).
    if (active && active.property === property) {
      restore();
      reset();
      return { active: false };
    }
    restore();

    let prov = null;
    if (captureAt === 'select') prov = io.provenance(el, property);

    const session = beginSession(io, el, property, prov);
    if (!session) return { active: false }; // empty scale / ramp on :root

    active = {
      session,
      property,
      el,
      io,
      origInline: io.readInline ? io.readInline(el, property) : '',
      prov,
    };

    const render =
      renderStrategy === 'colorRamp'
        ? colorRoleRamp(session, null)
        : stepperRender(session.current());
    return { active: true, render };
  };

  // Move one token along the scale and preview it (stepper controls only).
  const step = (dir) => {
    if (!active || freeText || !active.session.step) return null;
    const c = active.session.step(dir);
    preview(c.value);
    return { render: stepperRender(c) };
  };

  // Pick a primitive swatch and preview it (color control only).
  const pick = (token) => {
    if (!active || freeText || !active.session.pick) return null;
    const c = active.session.pick(token);
    if (!c) return null;
    preview(c.value);
    return { render: colorRoleRamp(active.session, token) };
  };

  // ---- Free-text control (copy) --------------------------------------------
  // Open an edit session for the picked element, seeding the field with its
  // current text. The client live-previews onto the element via preview().
  const arm = (el, io) => {
    const before = io.read(el, previewTarget);
    active = { session: model.begin(before), el, io, before };
    return { value: active.before };
  };

  // ---- Commit --------------------------------------------------------------
  // Turn the active session into an `edit` record (the 0003 contract), or null
  // when nothing was staged. The caller has already restored the preview for
  // the stepper/color paths (matching the old commitNote ordering); free-text
  // reads the live edited text BEFORE its caller restores. Provenance:
  //   - captureAt:'select' → reuse the stashed clean prov (color)
  //   - captureAt:'commit' → read it now (spacing/type)
  //   - captureAt:'none'   → none (copy passes the edited text instead)
  const commit = (commitInput) => {
    if (!active) return null;
    if (freeText) {
      // commitInput is the edited text (client reads it live before restore).
      return active.session.toEdit(commitInput);
    }
    const prov =
      captureAt === 'select'
        ? active.prov
        : active.io.provenance(active.el, active.property);
    return active.session.toEdit(prov);
  };

  return {
    previewTarget,
    captureAt,
    renderStrategy,
    get session() {
      return active;
    },
    isActive,
    select,
    step,
    pick,
    arm,
    preview,
    restore,
    reset,
    commit,
  };
};
