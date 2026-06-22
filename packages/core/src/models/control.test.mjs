/* eslint-disable */
// Run: node --import tsx --test src/models/control.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createControl } from './control.mjs';

// ---- Stub io adapter -------------------------------------------------------
// A fake element + io that record DOM-ish writes without a real DOM. `el.props`
// is the live inline-style map; `el.text` is textContent. `el.inline` is what a
// real element.style.getPropertyValue would return at select time.
const makeEl = (over = {}) => ({ props: {}, inline: {}, text: '', ...over });

const makeIo = (overrides = {}) => ({
  // current value the model seeds from (computed px / declared color / text)
  read: (el, target) => (target === 'textContent' ? el.text : el.props[target] ?? ''),
  // the existing inline value at select time (origInline)
  readInline: (el, target) => (target === 'textContent' ? el.text : el.inline[target] ?? ''),
  write: (el, target, value) => {
    if (target === 'textContent') el.text = value;
    else el.props[target] = value;
  },
  clear: (el, target) => {
    delete el.props[target];
  },
  provenance: (el, property) => ({ sourceKind: 'shared', value: el.inline[property] || null, property }),
  ...overrides,
});

// ---- Stub models -----------------------------------------------------------
// Mirror the real begin()/current()/step()/pick()/toEdit() interfaces.
const stubStepperModel = () => ({
  begin: (property, currentValue) => {
    if (!Number.isFinite(currentValue)) return null; // mimic empty-scale guard via NaN sentinel
    let idx = 1;
    const scale = [
      { token: '--s-0', value: '0px' },
      { token: '--s-1', value: '8px' },
      { token: '--s-2', value: '16px' },
    ];
    let offScale = true;
    const current = () => ({ property, ...scale[idx], offScale });
    return {
      property,
      current,
      step: (dir) => {
        const n = idx + (dir < 0 ? -1 : 1);
        if (n >= 0 && n < scale.length) { idx = n; offScale = false; }
        return current();
      },
      toEdit: (prov) => ({ property, before: `${currentValue}px`, after: { token: scale[idx].token, value: scale[idx].value, offScale }, provenance: prov || null, role: null }),
    };
  },
});

const stubColorModel = () => ({
  roleOf: (v) => (/var\(/.test(String(v || '')) ? '--role-x' : null),
  begin: (property, before, role) => {
    const swatches = [
      { name: '--c-100', value: '#eee' },
      { name: '--c-900', value: '#111' },
    ];
    if (!swatches.length) return null;
    let picked = null;
    return {
      property,
      role: role || null,
      swatches,
      current: () => picked,
      pick: (name) => { picked = swatches.find((s) => s.name === name) || picked; return picked; },
      toEdit: (prov) => (picked ? { kind: 'color', property, before: before || '', after: { token: picked.name, value: picked.value, offScale: false }, provenance: prov || null, role: role || null } : null),
    };
  },
});

const stubCopyModel = () => ({
  begin: (before) => {
    const orig = String(before == null ? '' : before).trim();
    return { before: orig, toEdit: (after) => { const n = String(after == null ? '' : after).trim(); return n === orig ? null : { type: 'copy', before: orig, after: n }; } };
  },
});

// ---- Config builders (the four the client instantiates) --------------------
const spacingControl = () => {
  const model = stubStepperModel();
  return createControl({
    model, previewTarget: 'padding', captureAt: 'commit', renderStrategy: 'stepper',
    beginSession: (io, el, property) => model.begin(property, parseFloat(io.read(el, property)) || 0),
  });
};
const colorControl = () => {
  const model = stubColorModel();
  return createControl({
    model, previewTarget: 'color', captureAt: 'select', renderStrategy: 'colorRamp',
    beginSession: (io, el, property, prov) => {
      const before = (prov && prov.value) || io.read(el, property);
      return model.begin(property, before, model.roleOf(prov && prov.value));
    },
  });
};
const typeControl = () => {
  const model = stubStepperModel();
  return createControl({
    model, previewTarget: 'font-size', captureAt: 'commit', renderStrategy: 'stepper',
    beginSession: (io, el, property) => model.begin(property, parseFloat(io.read(el, property)) || 0),
  });
};
const copyControl = () => {
  const model = stubCopyModel();
  return createControl({
    model, previewTarget: 'textContent', captureAt: 'none', renderStrategy: 'freeText', freeText: true,
  });
};

// ---- Spacing / Typography (stepper) ----------------------------------------
for (const [label, build] of [['spacing', spacingControl], ['typography', typeControl]]) {
  describe(`control — ${label} (stepper)`, () => {
    test('select seeds a session and returns a stepper render', () => {
      const ctl = build();
      const el = makeEl({ props: { [ctl.previewTarget]: '8px' } });
      const io = makeIo();
      const r = ctl.select(el, ctl.previewTarget, io);
      assert.equal(r.active, true);
      assert.equal(r.render.strategy, 'stepper');
      assert.equal(r.render.token, '--s-1');
      assert.equal(r.render.offScale, true);
      assert.equal(ctl.isActive(), true);
    });

    test('step previews onto the element and clears off-scale', () => {
      const ctl = build();
      const el = makeEl({ props: { [ctl.previewTarget]: '8px' } });
      const io = makeIo();
      ctl.select(el, ctl.previewTarget, io);
      const r = ctl.step(1);
      assert.equal(r.render.token, '--s-2');
      assert.equal(r.render.offScale, false);
      assert.equal(el.props[ctl.previewTarget], '16px'); // throwaway preview painted
    });

    test('re-selecting the active property toggles it off and restores', () => {
      const ctl = build();
      const el = makeEl({ props: { [ctl.previewTarget]: '8px' }, inline: { [ctl.previewTarget]: '8px' } });
      const io = makeIo();
      ctl.select(el, ctl.previewTarget, io);
      ctl.step(1); // pollute with 16px
      const r = ctl.select(el, ctl.previewTarget, io);
      assert.equal(r.active, false);
      assert.equal(ctl.isActive(), false);
      assert.equal(el.props[ctl.previewTarget], '8px'); // restored to origInline
    });

    test('restore removes the inline override when there was none', () => {
      const ctl = build();
      const el = makeEl({ props: { [ctl.previewTarget]: '8px' } }); // no inline seed
      const io = makeIo();
      ctl.select(el, ctl.previewTarget, io);
      ctl.step(1);
      ctl.restore();
      assert.equal(ctl.previewTarget in el.props, false); // cleared
    });

    test('commit reads provenance at commit-time and assembles the edit', () => {
      const ctl = build();
      const el = makeEl({ props: { [ctl.previewTarget]: '8px' } });
      let provCalls = 0;
      const io = makeIo({ provenance: (e, p) => { provCalls++; return { sourceKind: 'shared', property: p }; } });
      ctl.select(el, ctl.previewTarget, io);
      assert.equal(provCalls, 0); // NOT read at select time
      ctl.step(1);
      ctl.restore();
      const edit = ctl.commit();
      assert.equal(provCalls, 1); // read at commit time
      assert.equal(edit.after.token, '--s-2');
      assert.equal(edit.role, null);
      assert.equal(edit.provenance.sourceKind, 'shared');
    });

    test('select returns inactive when the model declines (empty scale)', () => {
      // A model whose begin() always returns null (no tokens on :root).
      const emptyModel = { begin: () => null };
      const ctl = createControl({
        model: emptyModel, previewTarget: 'padding', captureAt: 'commit', renderStrategy: 'stepper',
        beginSession: (io, el, property) => emptyModel.begin(property),
      });
      const r = ctl.select(makeEl(), 'padding', makeIo());
      assert.equal(r.active, false);
      assert.equal(ctl.isActive(), false);
    });
  });
}

// ---- Color (ramp, capture-at-select) ---------------------------------------
describe('control — color (ramp)', () => {
  test('select captures provenance BEFORE preview and returns a ramp render', () => {
    const ctl = colorControl();
    const el = makeEl({ props: { color: 'var(--role-x)' }, inline: { color: 'var(--role-x)' } });
    let provAtSelect = false;
    const io = makeIo({ provenance: (e, p) => { provAtSelect = true; return { sourceKind: 'shared', value: 'var(--role-x)', property: p }; } });
    const r = ctl.select(el, 'color', io);
    assert.equal(provAtSelect, true); // captured at select time
    assert.equal(r.active, true);
    assert.equal(r.render.strategy, 'colorRamp');
    assert.equal(r.render.role, '--role-x');
    assert.equal(r.render.swatches.length, 2);
    assert.equal(r.render.active, null); // nothing picked yet
  });

  test('pick previews the swatch value and flags the active token', () => {
    const ctl = colorControl();
    const el = makeEl({ props: { color: '#abc' }, inline: { color: '#abc' } });
    const io = makeIo({ provenance: () => ({ value: '#abc' }) });
    ctl.select(el, 'color', io);
    const r = ctl.pick('--c-900');
    assert.equal(r.render.active, '--c-900');
    assert.equal(el.props.color, '#111'); // preview painted
  });

  test('commit reuses the stashed select-time provenance (no second read)', () => {
    const ctl = colorControl();
    const el = makeEl({ props: { color: '#abc' }, inline: { color: '#abc' } });
    let provCalls = 0;
    const io = makeIo({ provenance: () => { provCalls++; return { value: '#abc', sourceKind: 'shared' }; } });
    ctl.select(el, 'color', io);
    ctl.pick('--c-900');
    ctl.restore();
    const edit = ctl.commit();
    assert.equal(provCalls, 1); // ONLY the select-time read
    assert.equal(edit.kind, 'color');
    assert.equal(edit.after.token, '--c-900');
    assert.equal(edit.provenance.sourceKind, 'shared');
  });

  test('commit returns null when no swatch was picked', () => {
    const ctl = colorControl();
    const el = makeEl({ props: { color: '#abc' } });
    const io = makeIo({ provenance: () => ({ value: '#abc' }) });
    ctl.select(el, 'color', io);
    ctl.restore();
    assert.equal(ctl.commit(), null);
  });
});

// ---- Copy (degenerate free-text) -------------------------------------------
describe('control — copy (free-text, degenerate)', () => {
  test('arm seeds the field with the element text', () => {
    const ctl = copyControl();
    const el = makeEl({ text: 'Hello' });
    const io = makeIo();
    const r = ctl.arm(el, io);
    assert.equal(r.value, 'Hello');
    assert.equal(ctl.isActive(), true);
  });

  test('select/step/pick are inert no-ops', () => {
    const ctl = copyControl();
    assert.deepEqual(ctl.select(makeEl(), 'textContent', makeIo()), { active: false });
    assert.equal(ctl.step(1), null);
    assert.equal(ctl.pick('x'), null);
  });

  test('preview swaps textContent; restore puts the original back', () => {
    const ctl = copyControl();
    const el = makeEl({ text: 'Hello' });
    const io = makeIo();
    ctl.arm(el, io);
    ctl.preview('Goodbye');
    assert.equal(el.text, 'Goodbye');
    ctl.restore();
    assert.equal(el.text, 'Hello');
  });

  test('commit turns changed text into a copy edit', () => {
    const ctl = copyControl();
    const el = makeEl({ text: 'Hello' });
    const io = makeIo();
    ctl.arm(el, io);
    el.text = 'Goodbye'; // simulate live preview before commit
    const edit = ctl.commit(el.text);
    assert.deepEqual(edit, { type: 'copy', before: 'Hello', after: 'Goodbye' });
  });

  test('commit returns null when the wording is unchanged', () => {
    const ctl = copyControl();
    const el = makeEl({ text: 'Hello' });
    ctl.arm(el, makeIo());
    assert.equal(ctl.commit('Hello'), null);
  });

  test('reset drops the session', () => {
    const ctl = copyControl();
    ctl.arm(makeEl({ text: 'Hi' }), makeIo());
    ctl.reset();
    assert.equal(ctl.isActive(), false);
  });
});
