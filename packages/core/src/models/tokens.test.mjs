/* eslint-disable */
// Run: node --test packages/core/src/models/
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

const mk = (vars, prefixHints) =>
  createTokens({
    doc: { documentElement: {} },
    win: { getComputedStyle: () => makeDecl(vars) },
    prefixHints,
  });

// ---------------------------------------------------------------------------
// Value-type classification — the design-system-agnostic core (ADR 0001).
// These fixtures use ARBITRARY, non-namespaced names: nothing about the prop
// name says "spacing" or "color"; classification is purely by resolved value.
// ---------------------------------------------------------------------------

const ARBITRARY = {
  '--brand-ink': '#0a64ff', // color (hex)
  '--brand-wash': 'rgb(245, 247, 250)', // color (rgb)
  '--brand-glass': 'transparent', // color (keyword)
  '--gap-cozy': '8px', // length
  '--gap-roomy': '24px', // length
  '--measure-tight': '1rem', // length (rem → 16px)
  '--weight-strong': '700', // unitless number
  '--ratio-airy': '1.5', // unitless number
  '--shadow': '0 1px 2px rgba(0,0,0,.2)', // not snappable → dropped
  '--font-stack': 'system-ui, sans-serif', // not snappable → dropped
};

test('zero-config: enumerate buckets arbitrary --* props by resolved value type', () => {
  const pools = mk(ARBITRARY).enumerate();
  assert.equal(pools.color.length, 3); // ink + wash + glass
  assert.equal(pools.length.length, 3); // gap-cozy/roomy + measure-tight
  assert.equal(pools.number.length, 2); // weight-strong + ratio-airy
  // unsnappable values (shadow, font stack) are dropped from every pool
  assert.ok(!pools.color.some((e) => e.name === '--shadow'));
  assert.ok(!pools.length.some((e) => e.name === '--font-stack'));
});

test('zero-config: a color value snaps against the color ramp, lengths against lengths', () => {
  const t = mk(ARBITRARY);
  // No prefix hints, yet the color ramp is the three color-typed props.
  assert.deepEqual(
    t.colorRamp().map((s) => s.name),
    ['--brand-ink', '--brand-wash', '--brand-glass'],
  );
  // A non-namespaced length snaps to the nearest length token by value.
  assert.deepEqual(t.snapSpacing(22), {
    name: '--gap-roomy',
    value: '24px',
    offScale: true,
  });
  assert.deepEqual(t.snapSpacing(8), {
    name: '--gap-cozy',
    value: '8px',
    offScale: false,
  });
});

test('zero-config: rem length tokens resolve against remBase before snapping', () => {
  // --measure-tight is 1rem = 16px; 15.5 is nearest to it, off the scale.
  assert.deepEqual(mk(ARBITRARY).snapFontSize(15.5), {
    name: '--measure-tight',
    value: '1rem',
    offScale: true,
  });
});

test('zero-config: unitless numbers snap against the number pool', () => {
  // 600 → nearest --weight-strong (700); 1.5 → exactly --ratio-airy.
  const t = mk(ARBITRARY);
  assert.deepEqual(t.snapFontWeight(600), {
    name: '--weight-strong',
    value: '700',
    offScale: true,
  });
  assert.deepEqual(t.snapFontLineHeight(1.5), {
    name: '--ratio-airy',
    value: '1.5',
    offScale: false,
  });
});

// ---------------------------------------------------------------------------
// Optional refinement — prefix hints sub-group a value type for nicer palettes.
// Refinement NEVER gates classification: every prop is still typed and snappable
// with zero config; hints only narrow which sub-pool a snapper draws from.
// ---------------------------------------------------------------------------

const NAMESPACED = {
  '--spacing-16': '16px',
  '--spacing-24': '24px',
  '--spacing-32': '32px',
  '--font-size-100': '14px',
  '--font-size-200': '1rem',
  '--font-weight-bold': '700',
  '--font-line-height-200': '1.5',
  '--surface-primary': '#fff',
  '--color-blue-500': '#0a64ff',
  '--unrelated-var': 'nope', // not a color/length/number → dropped
};

const HINTS = {
  spacing: '--spacing-',
  fontSize: '--font-size-',
  fontWeight: '--font-weight-',
  fontLineHeight: '--font-line-height-',
  primitiveColor: '--color-',
};

test('hints separate spacing from font-size even though both are lengths', () => {
  const t = mk(NAMESPACED, HINTS);
  assert.deepEqual(t.spacingScale(), [
    { name: '--spacing-16', value: '16px', px: 16 },
    { name: '--spacing-24', value: '24px', px: 24 },
    { name: '--spacing-32', value: '32px', px: 32 },
  ]);
  assert.deepEqual(t.fontSizeScale(), [
    { name: '--font-size-100', value: '14px', px: 14 },
    { name: '--font-size-200', value: '1rem', px: 16 },
  ]);
});

test('hints scope the color ramp to the primitive sub-group', () => {
  // Both --surface-primary and --color-blue-500 are color-typed; the hint keeps
  // only the primitive ramp as swatches.
  assert.deepEqual(mk(NAMESPACED, HINTS).colorRamp(), [
    { name: '--color-blue-500', value: '#0a64ff' },
  ]);
});

test('snapSpacing(24) returns the exact token, not off-scale', () => {
  assert.deepEqual(mk(NAMESPACED, HINTS).snapSpacing(24), {
    name: '--spacing-24',
    value: '24px',
    offScale: false,
  });
});

test('font weight/line-height scales narrow by hint', () => {
  const t = mk(NAMESPACED, HINTS);
  assert.deepEqual(t.fontWeightScale(), [
    { name: '--font-weight-bold', value: '700', px: 700 },
  ]);
  assert.deepEqual(t.fontLineHeightScale(), [
    { name: '--font-line-height-200', value: '1.5', px: 1.5 },
  ]);
});

test('a requested hint with no matching token falls back to the whole value-type pool', () => {
  // Arbitrary fixture has no --spacing- props, so the spacing snapper still
  // works against every length token rather than returning nothing.
  const t = mk(ARBITRARY, HINTS);
  assert.equal(t.snapSpacing(8).name, '--gap-cozy');
});

test('guards: non-finite input and empty token sets return null', () => {
  const t = mk(ARBITRARY);
  assert.equal(t.snapSpacing(NaN), null);
  assert.equal(t.snapSpacing(undefined), null);
  const empty = mk({});
  assert.equal(empty.snapSpacing(24), null);
  assert.deepEqual(empty.colorRamp(), []);
});
