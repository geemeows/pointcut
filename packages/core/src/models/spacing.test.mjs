/* eslint-disable */
// Run: node --test vite/design-toolbar/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokens } from './tokens.mjs';
import { createSpacingModel, SPACING_PROPS } from './spacing.mjs';

// Reuse the real tokens enumerator against a fake :root declaration, so the
// model is exercised through the same scale/snap surface client.js uses.
const makeDecl = (vars) => {
  const names = Object.keys(vars);
  const decl = { length: names.length, getPropertyValue: (k) => vars[k] || '' };
  names.forEach((n, i) => (decl[i] = n));
  return decl;
};
const VARS = { '--spacing-8': '8px', '--spacing-16': '16px', '--spacing-24': '24px' };
const model = (vars = VARS) =>
  createSpacingModel({
    tokens: createTokens({
      doc: { documentElement: {} },
      win: { getComputedStyle: () => makeDecl(vars) },
    }),
  });

test('exposes the padding/margin/gap properties', () => {
  assert.deepEqual(SPACING_PROPS, ['padding', 'margin', 'gap']);
  assert.deepEqual(model().props, ['padding', 'margin', 'gap']);
});

test('begin seeds at the exact token when the current px is on-scale', () => {
  const s = model().begin('padding', 16);
  assert.deepEqual(s.current(), {
    property: 'padding', token: '--spacing-16', value: '16px', px: 16, offScale: false,
  });
});

test('begin seeds at the nearest token and badges off-scale for a non-token px', () => {
  const s = model().begin('padding', 14);
  const c = s.current();
  assert.equal(c.token, '--spacing-16');
  assert.equal(c.offScale, true);
});

test('stepping moves along the scale and clears off-scale', () => {
  const s = model().begin('margin', 14); // nearest 16, off-scale
  assert.equal(s.step(-1).token, '--spacing-8'); // down one token
  assert.equal(s.current().offScale, false); // a step lands exactly on a token
  assert.equal(s.step(1).token, '--spacing-16');
  assert.equal(s.step(1).token, '--spacing-24');
});

test('stepping clamps at the ends of the scale', () => {
  const s = model().begin('gap', 24);
  assert.equal(s.step(1).token, '--spacing-24'); // already at the top
  s.step(-1); s.step(-1); s.step(-1);
  assert.equal(s.current().token, '--spacing-8'); // floored at the bottom
});

test('toEdit assembles the 0003 record with before, snapped after, and null role', () => {
  const s = model().begin('padding', 14); // before 14px, nearest 16 off-scale
  const prov = { selector: '.card', sourceKind: 'scoped', classList: ['card'] };
  s.step(1); // → --spacing-24, on-scale
  assert.deepEqual(s.toEdit(prov), {
    property: 'padding',
    before: '14px',
    after: { token: '--spacing-24', value: '24px', offScale: false },
    provenance: prov,
    role: null,
  });
});

test('toEdit without a step keeps the off-scale flag (needs a human decision)', () => {
  const s = model().begin('padding', 14);
  const e = s.toEdit(null);
  assert.equal(e.after.token, '--spacing-16');
  assert.equal(e.after.offScale, true);
  assert.equal(e.provenance, null);
});

test('begin returns null when there are no spacing tokens', () => {
  assert.equal(model({}).begin('padding', 10), null);
});
