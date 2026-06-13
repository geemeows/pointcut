/* eslint-disable */
// Run: node --test vite/design-toolbar/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokens } from './tokens.mjs';

// Fake CSSStyleDeclaration: array-like names + getPropertyValue, mirroring what
// getComputedStyle(:root) exposes for custom properties.
const makeDecl = (vars) => {
  const names = Object.keys(vars);
  const decl = {
    length: names.length,
    getPropertyValue: (k) => (vars[k] != null ? vars[k] : ''),
  };
  names.forEach((n, i) => {
    decl[i] = n;
  });
  return decl;
};

const VARS = {
  '--spacing-16': '16px',
  '--spacing-24': '24px',
  '--spacing-32': '32px',
  '--font-size-100': '14px',
  '--font-size-200': '1rem', // 16px at remBase 16
  '--font-weight-bold': '700',
  '--font-line-height-200': '1.5',
  '--surface-primary': '#fff',
  '--text-primary': '#111',
  '--border-subtle': '#eee',
  '--icon-default': '#222',
  '--color-blue-500': '#0a64ff',
  '--unrelated-var': 'nope',
};

const tokens = () =>
  createTokens({
    doc: { documentElement: {} },
    win: { getComputedStyle: () => makeDecl(VARS) },
  });

test('enumerate returns non-empty maps for spacing, typography, and color groups', () => {
  const t = tokens().enumerate();
  assert.equal(t.spacing.length, 3);
  assert.equal(t.fontSize.length, 2);
  assert.equal(t.fontWeight.length, 1);
  assert.equal(t.fontLineHeight.length, 1);
  assert.equal(t.semanticColor.length, 4); // surface/text/border/icon
  assert.equal(t.primitiveColor.length, 1); // --color-*
  // unrelated custom properties are dropped
  assert.ok(!t.spacing.some((e) => e.name === '--unrelated-var'));
});

test('snapSpacing(24) returns the exact token, not off-scale', () => {
  assert.deepEqual(tokens().snapSpacing(24), {
    name: '--spacing-24',
    value: '24px',
    offScale: false,
  });
});

test('snapSpacing(22) returns the nearest token and marks it off-scale', () => {
  assert.deepEqual(tokens().snapSpacing(22), {
    name: '--spacing-24',
    value: '24px',
    offScale: true,
  });
});

test('snapFontSize resolves rem token values against remBase', () => {
  // 15.5px is nearest to --font-size-200 (1rem = 16px), off the scale.
  assert.deepEqual(tokens().snapFontSize(15.5), {
    name: '--font-size-200',
    value: '1rem',
    offScale: true,
  });
});

test('spacingScale returns tokens ordered ascending by px with a px field', () => {
  const scale = tokens().spacingScale();
  assert.deepEqual(scale, [
    { name: '--spacing-16', value: '16px', px: 16 },
    { name: '--spacing-24', value: '24px', px: 24 },
    { name: '--spacing-32', value: '32px', px: 32 },
  ]);
});

test('snapFontWeight and snapFontLineHeight resolve unitless token values', () => {
  // 600 is nearest to --font-weight-bold (700), off the scale.
  assert.deepEqual(tokens().snapFontWeight(600), {
    name: '--font-weight-bold',
    value: '700',
    offScale: true,
  });
  // 1.5 is exactly --font-line-height-200.
  assert.deepEqual(tokens().snapFontLineHeight(1.5), {
    name: '--font-line-height-200',
    value: '1.5',
    offScale: false,
  });
});

test('font scales return tokens ordered ascending with a numeric field', () => {
  assert.deepEqual(tokens().fontSizeScale(), [
    { name: '--font-size-100', value: '14px', px: 14 },
    { name: '--font-size-200', value: '1rem', px: 16 },
  ]);
  assert.deepEqual(tokens().fontWeightScale(), [
    { name: '--font-weight-bold', value: '700', px: 700 },
  ]);
  assert.deepEqual(tokens().fontLineHeightScale(), [
    { name: '--font-line-height-200', value: '1.5', px: 1.5 },
  ]);
});

test('colorRamp returns the primitive --color-* swatches', () => {
  assert.deepEqual(tokens().colorRamp(), [
    { name: '--color-blue-500', value: '#0a64ff' },
  ]);
});

test('guards: non-finite input and empty token sets return null', () => {
  const t = tokens();
  assert.equal(t.snapSpacing(NaN), null);
  assert.equal(t.snapSpacing(undefined), null);
  const empty = createTokens({
    doc: { documentElement: {} },
    win: { getComputedStyle: () => makeDecl({}) },
  });
  assert.equal(empty.snapSpacing(24), null);
});
