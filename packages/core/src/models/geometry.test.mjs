/* eslint-disable */
// Run: node --import tsx --test src/models/geometry.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAP, BOTTOM_RESERVE, placeBeside, isOwn, labelFor, keyStylesOf,
  clampBarPos, flipDeltas, rightAnchorPos, cpanelPos,
} from './geometry.mjs';

const VP = { w: 1000, h: 800 };

describe('placeBeside', () => {
  test('places below the anchor when it fits', () => {
    const r = { top: 100, bottom: 120, left: 200, right: 260 };
    const out = placeBeside({ w: 296, h: 160 }, r, VP, undefined, undefined);
    assert.equal(out.side, 'below');
    assert.equal(out.top, 120 + GAP); // r.bottom + GAP
    assert.equal(out.left, 200); // align left → r.left
  });

  test('falls back above when below would overflow the bottom reserve', () => {
    const r = { top: 600, bottom: 620, left: 200, right: 260 };
    const out = placeBeside({ w: 296, h: 160 }, r, VP, undefined, undefined);
    assert.equal(out.side, 'above');
    assert.equal(out.top, 600 - 160 - GAP); // r.top - h - GAP
  });

  test('pins to a stable viewport edge when neither side fits', () => {
    const r = { top: 4, bottom: 790, left: 200, right: 260 };
    const out = placeBeside({ w: 296, h: 160 }, r, VP, undefined, undefined);
    assert.equal(out.side, 'pinned');
    assert.equal(out.top, VP.h - 160 - BOTTOM_RESERVE);
  });

  test('align:right extends leftward (right edge at the anchor)', () => {
    const r = { top: 100, bottom: 120, left: 600, right: 700 };
    const out = placeBeside({ w: 296, h: 160 }, r, VP, 'right', undefined);
    assert.equal(out.left, 700 - 296); // r.right - w
  });

  test('align:right flips to extend rightward when too tight on the left', () => {
    const r = { top: 100, bottom: 120, left: 100, right: 200 };
    const out = placeBeside({ w: 296, h: 160 }, r, VP, 'right', undefined);
    // r.right - w = 200 - 296 = -96 < GAP → use r.left (100)
    assert.equal(out.left, 100);
  });

  test('default align flips leftward when it would overflow the right edge', () => {
    const r = { top: 100, bottom: 120, left: 800, right: 860 };
    const out = placeBeside({ w: 296, h: 160 }, r, VP, undefined, undefined);
    // left = r.left = 800; 800+296 = 1096 > 1000-GAP → left = r.right - w = 860-296 = 564
    assert.equal(out.left, 564);
  });

  test('final clamp keeps the card inside both edges', () => {
    const r = { top: 100, bottom: 120, left: 990, right: 1100 };
    const out = placeBeside({ w: 296, h: 160 }, r, VP, undefined, undefined);
    assert.equal(out.left, VP.w - 296 - GAP); // clamped to right edge
    assert.ok(out.left >= GAP);
  });

  test('clamps top to never go above GAP', () => {
    const r = { top: 5, bottom: -100, left: 200, right: 260 };
    const out = placeBeside({ w: 296, h: 160 }, r, VP, undefined, 'above');
    // aboveTop = 5 - 160 - 8 = -163 → Math.max(top, GAP) = GAP
    assert.equal(out.top, GAP);
  });

  test('lockSide reuses the given side without re-deciding', () => {
    const r = { top: 600, bottom: 620, left: 200, right: 260 };
    const out = placeBeside({ w: 296, h: 160 }, r, VP, undefined, 'below');
    assert.equal(out.side, 'below');
    assert.equal(out.top, 620 + GAP);
  });
});

describe('isOwn', () => {
  test('true for the host itself', () => {
    const host = { tag: 'host' };
    assert.equal(isOwn(host, host), true);
  });
  test('true for a descendant (parentNode chain)', () => {
    const host = {};
    const child = { parentNode: host };
    const grandchild = { parentNode: child };
    assert.equal(isOwn(grandchild, host), true);
  });
  test('crosses a shadow boundary via .host', () => {
    const host = {};
    const shadowRoot = { host };
    const inShadow = { parentNode: shadowRoot };
    assert.equal(isOwn(inShadow, host), true);
  });
  test('false for an unrelated node', () => {
    const host = {};
    const other = { parentNode: { parentNode: null } };
    assert.equal(isOwn(other, host), false);
  });
});

describe('labelFor', () => {
  test('bare tag', () => {
    assert.equal(labelFor({ tagName: 'DIV', id: '', className: '' }), 'div');
  });
  test('tag with id', () => {
    assert.equal(labelFor({ tagName: 'SECTION', id: 'main', className: '' }), 'section#main');
  });
  test('tag with up to two classes', () => {
    assert.equal(labelFor({ tagName: 'P', id: '', className: 'a b c d' }), 'p.a.b');
  });
  test('tag with id and classes', () => {
    assert.equal(labelFor({ tagName: 'A', id: 'x', className: '  foo  ' }), 'a#x.foo');
  });
  test('ignores non-string className (SVGAnimatedString)', () => {
    assert.equal(labelFor({ tagName: 'svg', id: '', className: {} }), 'svg');
  });
});

describe('keyStylesOf', () => {
  test('plucks and trims present properties, drops empties', () => {
    const cs = { getPropertyValue: (p) => ({ color: ' red ', 'font-size': '16px', margin: '' }[p] || '') };
    const out = keyStylesOf(cs, ['color', 'font-size', 'margin', 'gap']);
    assert.deepEqual(out, { color: 'red', 'font-size': '16px' });
  });
});

describe('clampBarPos', () => {
  test('clamps within 8px of the viewport', () => {
    const out = clampBarPos(5000, 5000, { width: 200, height: 50 }, VP);
    assert.deepEqual(out, { left: VP.w - 200 - 8, top: VP.h - 50 - 8 });
  });
  test('clamps to the 8px minimum', () => {
    assert.deepEqual(clampBarPos(-100, -100, { width: 200, height: 50 }, VP), { left: 8, top: 8 });
  });
  test('passes through an in-bounds position', () => {
    assert.deepEqual(clampBarPos(300, 400, { width: 200, height: 50 }, VP), { left: 300, top: 400 });
  });
});

describe('flipDeltas', () => {
  test('computes translate + scale between two footprints', () => {
    const first = { left: 100, top: 200, width: 400, height: 60 };
    const last = { left: 150, top: 220, width: 200, height: 60 };
    assert.deepEqual(flipDeltas(first, last), { dx: -50, dy: -20, sx: 2, sy: 1 });
  });
});

describe('rightAnchorPos', () => {
  test('centres a new footprint on the old right edge', () => {
    const first = { left: 100, top: 200, right: 500, width: 400, height: 60 };
    assert.deepEqual(rightAnchorPos(first, 50, 50), { left: 450, top: 205 });
  });
});

describe('cpanelPos', () => {
  test('centres the cpanel on the bar, clamped, sitting above it', () => {
    const bar = { offsetLeft: 400, offsetTop: 700, offsetWidth: 200 };
    const out = cpanelPos(bar, 300, VP);
    // left = 400 + 100 - 150 = 350; bottom = max(8, 800-700+12) = 112
    assert.deepEqual(out, { left: 350, bottom: 112 });
  });
  test('clamps the cpanel left to the 8px minimum', () => {
    const bar = { offsetLeft: 0, offsetTop: 700, offsetWidth: 50 };
    const out = cpanelPos(bar, 300, VP);
    assert.equal(out.left, 8);
  });
});
