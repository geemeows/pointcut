/* eslint-disable */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeChanges, parseIntent, designText, copyText, intentLabel, propertyLabel,
  INTENT_OPTIONS, propertiesForIntent, defaultPropertyForIntent, cssPropertyForId,
  valueKind, isValidDesignValue, isDesignChangeValid, toEditableDesign, toEditableCopy,
  editsFromEditable, designValuePool, reduceEditor,
} from './changes.mjs';

test('describeChanges with no edits reports no-change for both lanes', () => {
  const { designChange, copyChange } = describeChanges({});
  assert.equal(designChange.status, 'no-change');
  assert.equal(copyChange.status, 'no-change');
  assert.equal(designText(designChange), 'No design change');
  assert.equal(copyText(copyChange), 'No copy change');
});

test('describeChanges maps a color fill edit to Color · Fill · <token>', () => {
  const a = { edits: [{ kind: 'color', property: 'background-color', before: '#000', after: { token: 'Red', value: '#f00' }, role: null }] };
  const { designChange } = describeChanges(a);
  assert.deepEqual(designChange, { intent: 'color', property: 'fill', value: 'Red', status: 'detected' });
  assert.equal(designText(designChange), 'Color · Fill · Red');
});

test('describeChanges maps a spacing margin edit, value from token', () => {
  const a = { edits: [{ property: 'margin', before: '16px', after: { token: '8px', value: '8px', offScale: false }, role: null }] };
  const { designChange } = describeChanges(a);
  assert.equal(designText(designChange), 'Spacing · Margin · 8px');
});

test('describeChanges maps a typography weight edit', () => {
  const a = { edits: [{ property: 'font-weight', before: '400', after: { token: '700', value: '700' }, role: null }] };
  assert.equal(designText(describeChanges(a).designChange), 'Type · Weight · 700');
});

test('describeChanges surfaces a copy edit as old → new', () => {
  const a = { edits: [{ type: 'copy', before: 'Vendor-styled button', after: 'Vendor button' }] };
  const { copyChange } = describeChanges(a);
  assert.deepEqual(copyChange, { oldText: 'Vendor-styled button', newText: 'Vendor button', status: 'detected' });
  assert.equal(copyText(copyChange), '"Vendor-styled button" → "Vendor button"');
});

test('describeChanges handles both a design and a copy edit together', () => {
  const a = {
    edits: [
      { type: 'copy', before: 'Old', after: 'New' },
      { kind: 'color', property: 'color', before: '#000', after: { token: 'Red' }, role: null },
    ],
  };
  const { designChange, copyChange } = describeChanges(a);
  assert.equal(designText(designChange), 'Color · Text · Red');
  assert.equal(copyText(copyChange), '"Old" → "New"');
});

test('describeChanges takes the first design edit when several exist', () => {
  const a = {
    edits: [
      { property: 'padding', before: '4px', after: { token: '8px' }, role: null },
      { property: 'gap', before: '2px', after: { token: '4px' }, role: null },
    ],
  };
  assert.equal(describeChanges(a).designChange.property, 'padding');
});

test('not-detected status renders the pending label', () => {
  assert.equal(designText({ status: 'not-detected' }), 'Not detected yet');
  assert.equal(copyText({ status: 'not-detected' }), 'Not detected yet');
});

// ---- parseIntent (edit-mode preview) -------------------------------------

test('parseIntent: obvious colour request → Color · Fill · <color>, no copy', () => {
  for (const [note, color] of [['make this red', 'Red'], ['make it blue', 'Blue'], ['change this to green', 'Green']]) {
    const { designChange, copyChange } = parseIntent(note);
    assert.equal(designText(designChange), `Color · Fill · ${color}`, note);
    assert.equal(copyText(copyChange), 'No copy change', note);
  }
});

test('parseIntent: obvious copy request → copy detected, design no-change', () => {
  for (const [note, next] of [
    ['rename this to Save', 'Save'],
    ['change text to Continue', 'Continue'],
    ['make the label Submit', 'Submit'],
  ]) {
    const { designChange, copyChange } = parseIntent(note);
    assert.equal(designText(designChange), 'No design change', note);
    assert.equal(copyText(copyChange), `"Current text" → "${next}"`, note);
  }
});

test('parseIntent: mixed request → both lanes detected', () => {
  const { designChange, copyChange } = parseIntent('make it red and rename it to Save');
  assert.equal(designText(designChange), 'Color · Fill · Red');
  assert.equal(copyText(copyChange), '"Current text" → "Save"');
});

test('parseIntent: vague request → design not-detected, copy no-change', () => {
  for (const note of ['looks bad', 'fix this', 'make it better']) {
    const { designChange, copyChange } = parseIntent(note);
    assert.equal(designText(designChange), 'Not detected yet', note);
    assert.equal(copyText(copyChange), 'No copy change', note);
  }
});

test('parseIntent: empty note is neutral (no false not-detected)', () => {
  const { designChange, copyChange } = parseIntent('   ');
  assert.equal(designText(designChange), 'No design change');
  assert.equal(copyText(copyChange), 'No copy change');
});

test('parseIntent: a colour word inside copy text is not a fill change', () => {
  const { designChange, copyChange } = parseIntent('rename this to Red Button');
  assert.equal(copyText(copyChange), '"Current text" → "Red Button"');
  assert.equal(designText(designChange), 'No design change');
});

test('parseIntent: weight/size adjectives map to Type', () => {
  assert.equal(designText(parseIntent('make this bold').designChange), 'Type · Weight · Bold');
  assert.equal(designText(parseIntent('make it bigger').designChange), 'Type · Size · Larger');
});

test('detecting status renders the loading label', () => {
  assert.equal(designText({ status: 'detecting' }), 'Detecting…');
  assert.equal(copyText({ status: 'detecting' }), 'Detecting…');
});

test('label helpers', () => {
  assert.equal(intentLabel('type'), 'Type');
  assert.equal(propertyLabel('lineHeight'), 'Line height');
  assert.equal(propertyLabel('borderColor'), 'Border');
});

// ---- Editable changes (CHANGE EDITOR) ------------------------------------

test('intent options are spacing/color/type, never copy', () => {
  assert.deepEqual(INTENT_OPTIONS.map((o) => o.id), ['spacing', 'color', 'type']);
});

test('property options follow the selected intent', () => {
  assert.deepEqual(propertiesForIntent('spacing').map((p) => p.id), ['padding', 'margin', 'gap']);
  assert.deepEqual(propertiesForIntent('color').map((p) => p.id), ['fill', 'textColor', 'borderColor']);
  assert.deepEqual(propertiesForIntent('type').map((p) => p.id), ['fontSize', 'fontWeight', 'lineHeight']);
});

test('default property is the first for each intent', () => {
  assert.equal(defaultPropertyForIntent('spacing'), 'padding');
  assert.equal(defaultPropertyForIntent('color'), 'fill');
  assert.equal(defaultPropertyForIntent('type'), 'fontSize');
});

test('cssPropertyForId reverses the property map', () => {
  assert.equal(cssPropertyForId('padding'), 'padding');
  assert.equal(cssPropertyForId('fill'), 'background-color');
  assert.equal(cssPropertyForId('borderColor'), 'border-color');
  assert.equal(cssPropertyForId('fontWeight'), 'font-weight');
});

test('valueKind classifies each property', () => {
  assert.equal(valueKind('padding'), 'length');
  assert.equal(valueKind('fill'), 'color');
  assert.equal(valueKind('fontWeight'), 'weight');
  assert.equal(valueKind('lineHeight'), 'number');
});

test('isValidDesignValue accepts literals and descriptors', () => {
  assert.ok(isValidDesignValue('padding', '24px'));
  assert.ok(isValidDesignValue('margin', '16px'));
  assert.ok(isValidDesignValue('fill', '#EF4444'));
  assert.ok(isValidDesignValue('fill', 'Red'));
  assert.ok(isValidDesignValue('fontWeight', '700'));
  assert.ok(isValidDesignValue('lineHeight', '1.5'));
});

test('isValidDesignValue rejects an empty value', () => {
  assert.ok(!isValidDesignValue('padding', ''));
  assert.ok(!isValidDesignValue('padding', null));
});

test('a token is valid only when it belongs to the property pool', () => {
  // The spec invariant: Spacing · Padding · --type-body must never be valid.
  assert.ok(!isValidDesignValue('padding', '--type-body', ['--space-lg', '--space-roomy']));
  assert.ok(isValidDesignValue('padding', '--space-roomy', ['--space-lg', '--space-roomy']));
  // Display form "--tok · 24px" validates against the bare token name.
  assert.ok(isValidDesignValue('padding', '--space-roomy · 24px', ['--space-roomy']));
  // Cross-lane tokens from the other spec examples.
  assert.ok(!isValidDesignValue('fill', '--space-lg', ['--color-danger']));
  assert.ok(!isValidDesignValue('fontWeight', '--color-danger', ['--type-bold']));
});

test('isDesignChangeValid lets non-detected lanes through', () => {
  assert.ok(isDesignChangeValid({ status: 'no-change' }));
  assert.ok(isDesignChangeValid({ status: 'not-detected' }));
  assert.ok(isDesignChangeValid(null));
});

test('isDesignChangeValid flags a detected lane with an out-of-lane token', () => {
  const bad = { status: 'detected', intent: 'spacing', property: 'padding', value: '--type-body' };
  assert.ok(!isDesignChangeValid(bad, ['--space-lg']));
  const good = { status: 'detected', intent: 'spacing', property: 'padding', value: '24px' };
  assert.ok(isDesignChangeValid(good, ['--space-lg']));
});

test('toEditableDesign / toEditableCopy carry the source', () => {
  const d = toEditableDesign({ intent: 'spacing', property: 'padding', value: '24px', status: 'detected' });
  assert.equal(d.source, 'auto-detected');
  assert.equal(d.property, 'padding');
  const m = toEditableDesign({ intent: 'color', property: 'fill', value: 'Red', status: 'detected' }, 'manual');
  assert.equal(m.source, 'manual');
  const c = toEditableCopy({ oldText: null, newText: 'Save', status: 'detected' });
  assert.equal(c.source, 'auto-detected');
  assert.equal(c.newText, 'Save');
});

test('editsFromEditable persists a manual design change round-tripping through describeChanges', () => {
  const design = { source: 'manual', intent: 'spacing', property: 'padding', value: '24px', status: 'detected' };
  const edits = editsFromEditable(design, { status: 'no-change' });
  assert.equal(edits.length, 1);
  assert.equal(edits[0].property, 'padding');
  assert.equal(edits[0].source, 'manual');
  // Round-trips to the exact same display string in view mode.
  assert.equal(designText(describeChanges({ edits }).designChange), 'Spacing · Padding · 24px');
});

test('editsFromEditable keeps the bare token name aside while displaying the full value', () => {
  const design = { source: 'manual', intent: 'spacing', property: 'padding', value: '--space-roomy · 24px', status: 'detected' };
  const [edit] = editsFromEditable(design, null);
  assert.equal(edit.after.tokenName, '--space-roomy');
  assert.equal(designText(describeChanges({ edits: [edit] }).designChange), 'Spacing · Padding · --space-roomy · 24px');
});

test('editsFromEditable persists a copy change and round-trips the placeholder', () => {
  const edits = editsFromEditable({ status: 'no-change' }, { source: 'manual', oldText: null, newText: 'Save', status: 'detected' });
  assert.equal(edits.length, 1);
  assert.equal(edits[0].type, 'copy');
  assert.equal(copyText(describeChanges({ edits }).copyChange), '"Current text" → "Save"');
});

test('editsFromEditable emits nothing for cleared lanes', () => {
  assert.deepEqual(editsFromEditable({ status: 'no-change' }, { status: 'no-change' }), []);
  assert.deepEqual(editsFromEditable({ status: 'not-detected' }, null), []);
});

// ---- designValuePool (value vocabulary dispatch) -------------------------

// A token introspection facade mirroring the client's `tokens` object. Each
// scale entry is { name, value }.
const fakeTokens = {
  spacingScale: () => [{ name: '--space-sm', value: '8px' }, { name: '--space-lg', value: '24px' }],
  colorRamp: () => [{ name: '--color-danger', value: '#EF4444' }],
  fontSizeScale: () => [{ name: '--type-body', value: '16px' }],
  fontWeightScale: () => [{ name: '--type-bold', value: '700' }],
  fontLineHeightScale: () => [{ name: '--lh-tight', value: '1.2' }],
};

test('designValuePool: spacing reads spacingScale for names + token-first options', () => {
  const { names, options } = designValuePool('padding', fakeTokens);
  assert.deepEqual(names, ['--space-sm', '--space-lg']);
  // Tokens first as "--name · value", then the length presets, then Custom….
  assert.deepEqual(options.map((o) => o.value), [
    '--space-sm · 8px', '--space-lg · 24px', '4px', '8px', '12px', '16px', '24px', '__custom__',
  ]);
  assert.equal(options[0].label, '--space-sm · 8px');
  assert.equal(options.at(-1).label, 'Custom…');
});

test('designValuePool: margin and gap share the spacing scale', () => {
  for (const p of ['margin', 'gap']) {
    const { names } = designValuePool(p, fakeTokens);
    assert.deepEqual(names, ['--space-sm', '--space-lg'], p);
  }
});

test('designValuePool: color lanes read colorRamp', () => {
  for (const p of ['fill', 'textColor', 'borderColor']) {
    const { names, options } = designValuePool(p, fakeTokens);
    assert.deepEqual(names, ['--color-danger'], p);
    assert.deepEqual(options.map((o) => o.value), [
      '--color-danger · #EF4444', '#EF4444', '#3B82F6', '#22C55E', '#111827', '#FFFFFF', '__custom__',
    ], p);
  }
});

test('designValuePool: fontSize / fontWeight / lineHeight read their own scales', () => {
  assert.deepEqual(designValuePool('fontSize', fakeTokens).names, ['--type-body']);
  assert.deepEqual(designValuePool('fontWeight', fakeTokens).names, ['--type-bold']);
  assert.deepEqual(designValuePool('lineHeight', fakeTokens).names, ['--lh-tight']);
  assert.deepEqual(designValuePool('fontWeight', fakeTokens).options.map((o) => o.value), [
    '--type-bold · 700', '400', '500', '600', '700', '__custom__',
  ]);
  assert.deepEqual(designValuePool('lineHeight', fakeTokens).options.map((o) => o.value), [
    '--lh-tight · 1.2', '1', '1.25', '1.5', '1.75', '__custom__',
  ]);
});

test('designValuePool: no tokens → presets + Custom only, empty names', () => {
  const empty = {
    spacingScale: () => [], colorRamp: () => [], fontSizeScale: () => [],
    fontWeightScale: () => [], fontLineHeightScale: () => [],
  };
  const { names, options } = designValuePool('padding', empty);
  assert.deepEqual(names, []);
  assert.deepEqual(options.map((o) => o.value), ['4px', '8px', '12px', '16px', '24px', '__custom__']);
  // Missing tokens facade altogether is tolerated.
  assert.deepEqual(designValuePool('padding').names, []);
  assert.deepEqual(designValuePool('padding', undefined).options.map((o) => o.value), [
    '4px', '8px', '12px', '16px', '24px', '__custom__',
  ]);
});

test('designValuePool: unknown property yields only Custom…', () => {
  assert.deepEqual(designValuePool('bogus', fakeTokens), {
    names: [], options: [{ value: '__custom__', label: 'Custom…' }],
  });
});

test('designValuePool: a duplicate token/preset value is de-duped', () => {
  // '8px' is both a spacing token value and a length preset → one option.
  const { options } = designValuePool('padding', fakeTokens);
  const eightPx = options.filter((o) => o.value === '8px');
  assert.equal(eightPx.length, 1);
});

// ---- reduceEditor (popDraft state machine) -------------------------------

const seedDraft = (over = {}) => ({
  note: 'hi',
  design: { source: 'auto-detected', intent: null, property: null, value: null, status: 'no-change' },
  copy: { source: 'auto-detected', oldText: null, newText: null, status: 'no-change' },
  designOpen: false,
  copyOpen: false,
  designCustom: false,
  detecting: false,
  ...over,
});

test('reduceEditor: null draft is a no-op (repaint true, draft unchanged)', () => {
  const { draft, repaint } = reduceEditor(null, { type: 'toggle-design' });
  assert.equal(draft, null);
  assert.equal(repaint, true);
});

test('reduceEditor: unknown event returns the draft untouched', () => {
  const d = seedDraft();
  const { draft } = reduceEditor(d, { type: 'nope' });
  assert.deepEqual(draft, d);
});

test('reduceEditor: toggle-design on an unset lane seeds a manual default + opens', () => {
  const { draft, repaint } = reduceEditor(seedDraft(), { type: 'toggle-design', tokens: fakeTokens });
  assert.equal(repaint, true);
  assert.equal(draft.designOpen, true);
  assert.deepEqual(draft.design, {
    source: 'manual', intent: 'spacing', property: 'padding',
    value: '--space-sm · 8px', status: 'detected',
  });
  assert.equal(draft.designCustom, false);
});

test('reduceEditor: toggle-design default value falls back to a preset with no tokens', () => {
  const { draft } = reduceEditor(seedDraft(), { type: 'toggle-design' });
  assert.equal(draft.design.value, '4px');
});

test('reduceEditor: toggle-design on a detected lane just expands (no reseed)', () => {
  const d = seedDraft({ design: { source: 'manual', intent: 'color', property: 'fill', value: 'Red', status: 'detected' } });
  const { draft } = reduceEditor(d, { type: 'toggle-design', tokens: fakeTokens });
  assert.equal(draft.designOpen, true);
  assert.deepEqual(draft.design, d.design);
});

test('reduceEditor: toggle-design collapses an open lane', () => {
  const { draft } = reduceEditor(seedDraft({ designOpen: true }), { type: 'toggle-design' });
  assert.equal(draft.designOpen, false);
});

test('reduceEditor: toggle-copy on an unset lane seeds manual newText="" preserving oldText', () => {
  const { draft } = reduceEditor(seedDraft({ copy: { source: 'auto-detected', oldText: 'Save', newText: null, status: 'no-change' } }), { type: 'toggle-copy' });
  assert.equal(draft.copyOpen, true);
  assert.deepEqual(draft.copy, { source: 'manual', oldText: 'Save', newText: '', status: 'detected' });
});

test('reduceEditor: toggle-copy on a detected lane just expands', () => {
  const d = seedDraft({ copy: { source: 'manual', oldText: 'A', newText: 'B', status: 'detected' } });
  const { draft } = reduceEditor(d, { type: 'toggle-copy' });
  assert.equal(draft.copyOpen, true);
  assert.deepEqual(draft.copy, d.copy);
});

test('reduceEditor: clear-design wipes to manual no-change and collapses', () => {
  const d = seedDraft({ designOpen: true, designCustom: true, design: { source: 'manual', intent: 'spacing', property: 'gap', value: '8px', status: 'detected' } });
  const { draft } = reduceEditor(d, { type: 'clear-design' });
  assert.deepEqual(draft.design, { source: 'manual', intent: null, property: null, value: null, status: 'no-change' });
  assert.equal(draft.designCustom, false);
  assert.equal(draft.designOpen, false);
});

test('reduceEditor: clear-copy wipes to manual no-change, keeps oldText, collapses', () => {
  const d = seedDraft({ copyOpen: true, copy: { source: 'manual', oldText: 'Orig', newText: 'New', status: 'detected' } });
  const { draft } = reduceEditor(d, { type: 'clear-copy' });
  assert.deepEqual(draft.copy, { source: 'manual', oldText: 'Orig', newText: null, status: 'no-change' });
  assert.equal(draft.copyOpen, false);
});

test('reduceEditor: detect-design adopts parsed result, source back to auto-detected', () => {
  const parsed = parseIntent('make this red');
  const { draft } = reduceEditor(seedDraft({ design: { source: 'manual', intent: 'type', property: 'fontSize', value: '20px', status: 'detected' }, designCustom: true }), { type: 'detect-design', parsed });
  assert.equal(draft.design.source, 'auto-detected');
  assert.equal(draft.design.intent, 'color');
  assert.equal(draft.design.property, 'fill');
  assert.equal(draft.design.status, 'detected');
  assert.equal(draft.designOpen, true); // detected → stays expanded
  assert.equal(draft.designCustom, false);
});

test('reduceEditor: detect-design collapses when nothing detected', () => {
  const parsed = parseIntent('looks bad'); // design not-detected
  const { draft } = reduceEditor(seedDraft({ designOpen: true }), { type: 'detect-design', parsed });
  assert.equal(draft.design.status, 'not-detected');
  assert.equal(draft.designOpen, false);
});

test('reduceEditor: detect-copy adopts parsed copy and opens only when detected', () => {
  const parsed = parseIntent('rename this to Save');
  const { draft } = reduceEditor(seedDraft(), { type: 'detect-copy', parsed });
  assert.equal(draft.copy.source, 'auto-detected');
  assert.equal(draft.copy.newText, 'Save');
  assert.equal(draft.copyOpen, true);

  const none = reduceEditor(seedDraft({ copyOpen: true }), { type: 'detect-copy', parsed: parseIntent('looks bad') });
  assert.equal(none.draft.copyOpen, false);
});

test('reduceEditor: field-change ed-intent resets property+value and flips source to manual', () => {
  const d = seedDraft({ design: { source: 'auto-detected', intent: 'spacing', property: 'padding', value: '8px', status: 'detected' }, designCustom: true });
  const { draft, repaint } = reduceEditor(d, { type: 'field-change', field: 'ed-intent', value: 'color', tokens: fakeTokens });
  assert.equal(repaint, true);
  assert.equal(draft.design.intent, 'color');
  assert.equal(draft.design.property, 'fill'); // default for color
  assert.equal(draft.design.value, '--color-danger · #EF4444'); // first option
  assert.equal(draft.design.source, 'manual');
  assert.equal(draft.design.status, 'detected');
  assert.equal(draft.designCustom, false);
});

test('reduceEditor: field-change ed-property resets value, source manual', () => {
  const d = seedDraft({ design: { source: 'auto-detected', intent: 'spacing', property: 'padding', value: '8px', status: 'detected' } });
  const { draft } = reduceEditor(d, { type: 'field-change', field: 'ed-property', value: 'gap', tokens: fakeTokens });
  assert.equal(draft.design.property, 'gap');
  assert.equal(draft.design.value, '--space-sm · 8px');
  assert.equal(draft.design.source, 'manual');
});

test('reduceEditor: field-change ed-value picks a concrete value', () => {
  const d = seedDraft({ design: { source: 'auto-detected', intent: 'spacing', property: 'padding', value: '8px', status: 'detected' } });
  const { draft } = reduceEditor(d, { type: 'field-change', field: 'ed-value', value: '12px' });
  assert.equal(draft.design.value, '12px');
  assert.equal(draft.design.source, 'manual');
  assert.equal(draft.designCustom, false);
});

test('reduceEditor: field-change ed-value __custom__ clears value and arms custom', () => {
  const d = seedDraft({ design: { source: 'auto-detected', intent: 'spacing', property: 'padding', value: '8px', status: 'detected' } });
  const { draft } = reduceEditor(d, { type: 'field-change', field: 'ed-value', value: '__custom__' });
  assert.equal(draft.design.value, '');
  assert.equal(draft.designCustom, true);
  assert.equal(draft.design.source, 'manual');
});

test('reduceEditor: field-input ed-value-custom updates value WITHOUT repaint (caret preserved)', () => {
  const d = seedDraft({ designCustom: true, design: { source: 'auto-detected', intent: 'spacing', property: 'padding', value: '', status: 'detected' } });
  const { draft, repaint } = reduceEditor(d, { type: 'field-input', field: 'ed-value-custom', value: '20p' });
  assert.equal(repaint, false);
  assert.equal(draft.design.value, '20p');
  assert.equal(draft.design.source, 'manual');
  assert.equal(draft.design.status, 'detected');
});

test('reduceEditor: field-input ed-copy-new updates newText WITHOUT repaint', () => {
  const d = seedDraft({ copyOpen: true, copy: { source: 'auto-detected', oldText: 'Old', newText: '', status: 'detected' } });
  const { draft, repaint } = reduceEditor(d, { type: 'field-input', field: 'ed-copy-new', value: 'Sav' });
  assert.equal(repaint, false);
  assert.equal(draft.copy.newText, 'Sav');
  assert.equal(draft.copy.source, 'manual');
  assert.equal(draft.copy.oldText, 'Old');
});

test('reduceEditor: does not mutate the input draft (returns a new object)', () => {
  const d = seedDraft();
  const before = JSON.parse(JSON.stringify(d));
  reduceEditor(d, { type: 'toggle-design', tokens: fakeTokens });
  assert.deepEqual(d, before);
});
