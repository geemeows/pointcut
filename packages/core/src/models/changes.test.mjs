/* eslint-disable */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeChanges, parseIntent, designText, copyText, intentLabel, propertyLabel,
  INTENT_OPTIONS, propertiesForIntent, defaultPropertyForIntent, cssPropertyForId,
  valueKind, isValidDesignValue, isDesignChangeValid, toEditableDesign, toEditableCopy,
  editsFromEditable,
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
