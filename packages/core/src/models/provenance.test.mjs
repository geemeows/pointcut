/* eslint-disable */
// Run: node --test packages/core/src/models/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvenance } from './provenance.mjs';

// Fake CSSStyleRule / sheet / element, just enough for the walker.
const rule = (selectorText, decls) => ({
  selectorText,
  style: { getPropertyValue: (p) => (decls[p] != null ? decls[p] : '') },
});
const sheet = (href, rules) => ({ href, cssRules: rules });

const makeEl = ({ tagName = 'div', classList = [], inline = {}, matches = [] }) => ({
  tagName: tagName.toUpperCase(),
  classList,
  style: { getPropertyValue: (p) => (inline[p] != null ? inline[p] : '') },
  matches: (sel) => matches.includes(sel),
});

test('scoped <style scoped> rule → sourceKind scoped + matching selector', () => {
  const doc = {
    styleSheets: [
      sheet('app/components/Button.vue', [
        rule('.btn[data-v-1a2b3c]', { padding: '24px' }),
      ]),
    ],
  };
  const p = createProvenance({ doc });
  const el = makeEl({ classList: ['btn'], matches: ['.btn[data-v-1a2b3c]'] });
  const r = p.inspect(el, 'padding');
  assert.equal(r.sourceKind, 'scoped');
  assert.equal(r.selector, '.btn[data-v-1a2b3c]');
  assert.equal(r.value, '24px');
  assert.deepEqual(r.classList, ['btn']);
});

// Agnostic vendor detection: ownership comes from the winning rule's stylesheet
// href resolving under node_modules — NOT from any design-system name. The
// selector below (`--app-btn`) is non-namespaced, proving the flag is origin-
// driven, not name-driven.
test('winning rule from a node_modules stylesheet → sourceKind vendor + usage-site guidance', () => {
  const doc = {
    styleSheets: [
      sheet('http://localhost:5173/node_modules/some-ui-kit/dist/styles.css', [
        rule('.ui-btn', { 'background-color': 'blue' }),
      ]),
    ],
  };
  const p = createProvenance({ doc });
  const el = makeEl({ classList: ['ui-btn'], matches: ['.ui-btn'] });
  const r = p.inspect(el, 'background-color');
  assert.equal(r.sourceKind, 'vendor');
  assert.match(r.guidance, /usage site/);
  assert.match(r.guidance, /do not edit node_modules/);
  assert.match(r.href, /node_modules/);
});

test('vendor wins only when it is the cascade winner — a higher-specificity app rule reclaims ownership', () => {
  const doc = {
    styleSheets: [
      sheet('http://localhost:5173/node_modules/some-ui-kit/dist/styles.css', [
        rule('.ui-btn', { color: 'blue' }),
      ]),
      sheet('app/styles/main.css', [rule('.page .ui-btn', { color: 'red' })]),
    ],
  };
  const p = createProvenance({ doc });
  const el = makeEl({ classList: ['ui-btn'], matches: ['.ui-btn', '.page .ui-btn'] });
  const r = p.inspect(el, 'color');
  assert.equal(r.sourceKind, 'shared'); // app rule wins → editable at source
  assert.equal(r.value, 'red');
});

test('vendorOrigins refinement widens the net (e.g. a vendored /lib/ dir)', () => {
  const doc = {
    styleSheets: [
      sheet('http://localhost:5173/vendor/lib/widget.css', [
        rule('.widget', { padding: '4px' }),
      ]),
    ],
  };
  const p = createProvenance({ doc, vendorOrigins: ['/vendor/lib/'] });
  const el = makeEl({ classList: ['widget'], matches: ['.widget'] });
  const r = p.inspect(el, 'padding');
  assert.equal(r.sourceKind, 'vendor');
});

test('a custom-element tag is NOT vendor by itself — identity comes from origin/stamp, not the tag name', () => {
  // An app-authored web component whose styles live in an app sheet is editable.
  const doc = {
    styleSheets: [sheet('app/styles/main.css', [rule('my-button', { color: '#111' })])],
  };
  const p = createProvenance({ doc });
  const el = makeEl({ tagName: 'my-button', matches: ['my-button'] });
  const r = p.inspect(el, 'color');
  assert.equal(r.sourceKind, 'shared');
});

test('inline style → sourceKind inline (beats stylesheet rules)', () => {
  const doc = {
    styleSheets: [sheet('app/styles/main.css', [rule('.box', { margin: '8px' })])],
  };
  const p = createProvenance({ doc });
  const el = makeEl({ classList: ['box'], inline: { margin: '13px' }, matches: ['.box'] });
  const r = p.inspect(el, 'margin');
  assert.equal(r.sourceKind, 'inline');
  assert.equal(r.value, '13px');
  assert.equal(r.selector, null);
});

test('global shared stylesheet → sourceKind shared', () => {
  const doc = {
    styleSheets: [
      sheet('app/styles/main.css', [rule('.container', { 'max-width': '1200px' })]),
    ],
  };
  const p = createProvenance({ doc });
  const el = makeEl({ classList: ['container'], matches: ['.container'] });
  const r = p.inspect(el, 'max-width');
  assert.equal(r.sourceKind, 'shared');
  assert.equal(r.selector, '.container');
});

test('cascade winner: higher specificity rule wins over an earlier match', () => {
  const doc = {
    styleSheets: [
      sheet('app/styles/main.css', [
        rule('.btn', { padding: '8px' }),
        rule('.panel .btn', { padding: '16px' }),
      ]),
    ],
  };
  const p = createProvenance({ doc });
  const el = makeEl({ classList: ['btn'], matches: ['.btn', '.panel .btn'] });
  const r = p.inspect(el, 'padding');
  assert.equal(r.value, '16px');
  assert.equal(r.selector, '.panel .btn');
});

test('an unreachable cross-origin sheet (throws on cssRules) is skipped, not fatal', () => {
  const cors = { href: 'https://cdn.example.com/x.css', get cssRules() { throw new Error('SecurityError'); } };
  const doc = {
    styleSheets: [cors, sheet('app/styles/main.css', [rule('.x', { color: 'green' })])],
  };
  const p = createProvenance({ doc });
  const el = makeEl({ classList: ['x'], matches: ['.x'] });
  const r = p.inspect(el, 'color');
  assert.equal(r.sourceKind, 'shared');
  assert.equal(r.value, 'green');
});
