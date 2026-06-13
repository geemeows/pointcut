/* eslint-disable */
// Run: node --test vite/design-toolbar/
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

test('Spark-owned sheet → sourceKind spark + node_modules guidance', () => {
  const doc = {
    styleSheets: [
      sheet('node_modules/vue-sparkui/spark/button.css', [
        rule('.spark-button', { 'background-color': 'blue' }),
      ]),
    ],
  };
  const p = createProvenance({ doc });
  const el = makeEl({ classList: ['spark-button'], matches: ['.spark-button'] });
  const r = p.inspect(el, 'background-color');
  assert.equal(r.sourceKind, 'spark');
  assert.match(r.guidance, /do not edit node_modules/);
});

test('Ibg* tag is detected as Spark even without a Spark sheet', () => {
  const doc = { styleSheets: [] };
  const p = createProvenance({ doc });
  const el = makeEl({ tagName: 'ibg-button' });
  const r = p.inspect(el, 'color');
  assert.equal(r.sourceKind, 'spark');
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
