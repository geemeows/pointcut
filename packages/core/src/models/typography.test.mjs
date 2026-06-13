/* eslint-disable */
// Run: node --test vite/design-toolbar/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokens } from './tokens.mjs';
import { createTypographyModel, TYPOGRAPHY_PROPS } from './typography.mjs';

// Reuse the real tokens enumerator against a fake :root declaration, so the
// model is exercised through the same scale/snap surface client.js uses.
const makeDecl = (vars) => {
  const names = Object.keys(vars);
  const decl = { length: names.length, getPropertyValue: (k) => vars[k] || '' };
  names.forEach((n, i) => (decl[i] = n));
  return decl;
};
const VARS = {
  '--font-size-100': '14px',
  '--font-size-200': '1rem', // 16px at remBase 16
  '--font-size-300': '20px',
  '--font-weight-regular': '400',
  '--font-weight-medium': '500',
  '--font-weight-bold': '700',
  '--font-line-height-100': '1.2',
  '--font-line-height-200': '1.5',
};
// Length-typed sizes and number-typed weights/line-heights overlap by value
// type (ADR 0001), so this namespaced fixture passes prefix hints — the optional
// refinement layer — to keep the three facets in separate scales.
const HINTS = {
  fontSize: '--font-size-',
  fontWeight: '--font-weight-',
  fontLineHeight: '--font-line-height-',
};
const model = (vars = VARS) =>
  createTypographyModel({
    tokens: createTokens({
      doc: { documentElement: {} },
      win: { getComputedStyle: () => makeDecl(vars) },
      prefixHints: HINTS,
    }),
  });

test('exposes the size/weight/line-height CSS properties', () => {
  assert.deepEqual(TYPOGRAPHY_PROPS, ['font-size', 'font-weight', 'line-height']);
  assert.deepEqual(model().props, ['font-size', 'font-weight', 'line-height']);
});

test('begin seeds font-size at the exact token when on-scale', () => {
  const s = model().begin('font-size', 16);
  assert.deepEqual(s.current(), {
    property: 'font-size', token: '--font-size-200', value: '1rem', px: 16, offScale: false,
  });
});

test('begin seeds at the nearest token and badges off-scale for a non-token value', () => {
  const s = model().begin('font-size', 15.5);
  const c = s.current();
  assert.equal(c.token, '--font-size-200'); // nearest to 16
  assert.equal(c.offScale, true);
});

test('stepping moves along the scale and clears off-scale', () => {
  const s = model().begin('font-size', 15.5); // nearest 16 (--font-size-200), off-scale
  assert.equal(s.step(-1).token, '--font-size-100'); // down one token (14px)
  assert.equal(s.current().offScale, false);
  assert.equal(s.step(1).token, '--font-size-200');
  assert.equal(s.step(1).token, '--font-size-300');
  assert.equal(s.step(1).token, '--font-size-300'); // clamped at the top
});

test('weight and line-height step through their own unitless scales', () => {
  const w = model().begin('font-weight', 400);
  assert.equal(w.current().token, '--font-weight-regular');
  assert.equal(w.step(1).token, '--font-weight-medium');
  const lh = model().begin('line-height', 1.5);
  assert.equal(lh.current().token, '--font-line-height-200');
  assert.equal(lh.step(-1).token, '--font-line-height-100');
});

test('toEdit assembles the 0003 record with a null role and per-facet before format', () => {
  const prov = { selector: '.title', sourceKind: 'scoped', classList: ['title'] };
  const size = model().begin('font-size', 15); // before rounds to 15px
  size.step(1); // → --font-size-200, on-scale
  assert.deepEqual(size.toEdit(prov), {
    property: 'font-size',
    before: '15px',
    after: { token: '--font-size-200', value: '1rem', offScale: false },
    provenance: prov,
    role: null,
  });
  // weight before is the bare integer; line-height keeps decimals.
  assert.equal(model().begin('font-weight', 400).toEdit(null).before, '400');
  assert.equal(model().begin('line-height', 1.45).toEdit(null).before, '1.45');
});

test('toEdit without a step keeps the off-scale flag (needs a human decision)', () => {
  const s = model().begin('font-size', 15.5);
  const e = s.toEdit(null);
  assert.equal(e.after.token, '--font-size-200');
  assert.equal(e.after.offScale, true);
  assert.equal(e.provenance, null);
});

test('begin returns null for an unknown property or an empty scale', () => {
  assert.equal(model().begin('font-family', 16), null);
  assert.equal(model({}).begin('font-size', 16), null);
});
