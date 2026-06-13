/* eslint-disable */
// Run: node --test vite/design-toolbar/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokens } from './tokens.mjs';
import { createColorModel, COLOR_PROPS } from './color.mjs';

// Reuse the real tokens enumerator against a fake :root declaration, so the
// model is exercised through the same ramp surface client.js uses.
const makeDecl = (vars) => {
  const names = Object.keys(vars);
  const decl = { length: names.length, getPropertyValue: (k) => vars[k] || '' };
  names.forEach((n, i) => (decl[i] = n));
  return decl;
};
const VARS = {
  '--color-blue-500': '#0a64ff',
  '--color-blue-600': '#0850cc',
  '--color-red-500': '#e5484d',
};
const model = (vars = VARS) =>
  createColorModel({
    tokens: createTokens({
      doc: { documentElement: {} },
      win: { getComputedStyle: () => makeDecl(vars) },
    }),
  });

test('exposes the fill/text/border CSS properties', () => {
  assert.deepEqual(COLOR_PROPS, ['background-color', 'color', 'border-color']);
  assert.deepEqual(model().props, ['background-color', 'color', 'border-color']);
});

test('roleOf extracts the semantic role from a var() declaration', () => {
  const m = model();
  assert.equal(m.roleOf('var(--surface-brand-default)'), '--surface-brand-default');
  assert.equal(m.roleOf('var( --text-primary )'), '--text-primary');
  assert.equal(m.roleOf('var(--border-subtle, #eee)'), '--border-subtle');
});

test('roleOf returns null for a raw color or a primitive ref (no semantic role)', () => {
  const m = model();
  assert.equal(m.roleOf('#0a64ff'), null);
  assert.equal(m.roleOf('rgb(10, 100, 255)'), null);
  assert.equal(m.roleOf('var(--color-blue-500)'), null); // primitive, not semantic
  assert.equal(m.roleOf(''), null);
});

test('begin exposes the ramp and starts with nothing picked', () => {
  const s = model().begin('background-color', 'var(--surface-brand-default)', '--surface-brand-default');
  assert.equal(s.property, 'background-color');
  assert.equal(s.role, '--surface-brand-default');
  assert.equal(s.swatches.length, 3);
  assert.equal(s.current(), null);
});

test('pick selects a swatch by name; unknown names are ignored', () => {
  const s = model().begin('color', '#111', null);
  assert.deepEqual(s.pick('--color-red-500'), { name: '--color-red-500', value: '#e5484d' });
  assert.deepEqual(s.current(), { name: '--color-red-500', value: '#e5484d' });
  s.pick('--color-nope');
  assert.equal(s.current().name, '--color-red-500'); // unchanged
});

test('toEdit assembles the 0005 record with role, picked primitive, and kind:color', () => {
  const s = model().begin('background-color', 'var(--surface-brand-default)', '--surface-brand-default');
  const prov = { selector: '.card', sourceKind: 'scoped', classList: ['card'] };
  s.pick('--color-blue-600');
  assert.deepEqual(s.toEdit(prov), {
    kind: 'color',
    property: 'background-color',
    before: 'var(--surface-brand-default)',
    after: { token: '--color-blue-600', value: '#0850cc', offScale: false },
    provenance: prov,
    role: '--surface-brand-default',
  });
});

test('toEdit carries a null role when no semantic role applies', () => {
  const s = model().begin('color', '#111', null);
  s.pick('--color-blue-500');
  const e = s.toEdit(null);
  assert.equal(e.role, null);
  assert.equal(e.after.token, '--color-blue-500');
});

test('toEdit returns null when no swatch was picked', () => {
  const s = model().begin('background-color', '#fff', '--surface-primary');
  assert.equal(s.toEdit({ selector: '.x' }), null);
});

test('begin returns null when the ramp is empty', () => {
  assert.equal(model({}).begin('color', '#111', null), null);
});
