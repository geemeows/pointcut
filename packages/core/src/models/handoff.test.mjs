/* eslint-disable */
// Run: node --test vite/design-toolbar/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HANDOFF_HEADER,
  blockFor,
  buildHandoff,
  editBlock,
  CONTEXT_HEADER,
  chipBlock,
  contextChipsBlock,
} from './handoff.mjs';

const TYPES = [
  { id: 'layout', label: 'Layout' },
  { id: 'color', label: 'Color' },
];

const base = {
  type: 'color',
  label: 'div.card',
  loc: 'app/x.vue:10:3',
  comment: 'make it blue',
  outerHTML: '',
  screenshot: null,
};

test('blockFor renders type label, source and change', () => {
  const md = blockFor(base, 2, false, TYPES);
  assert.match(md, /### 2\. \[Color\] div\.card/);
  assert.match(md, /\*\*Source:\*\* `app\/x\.vue:10:3`/);
  assert.match(md, /\*\*Change:\*\* make it blue/);
});

test('unknown type falls back to the first type', () => {
  const md = blockFor({ ...base, type: 'nope' }, 1, false, TYPES);
  assert.match(md, /\[Layout\]/);
});

test('missing loc reads as unknown', () => {
  const md = blockFor({ ...base, loc: '' }, 1, false, TYPES);
  assert.match(md, /\*\*Source:\*\* `unknown`/);
});

test('screenshot: embed inlines a data url, otherwise a paste note', () => {
  const withShot = { ...base, screenshot: 'data:image/png;base64,AAA' };
  assert.match(blockFor(withShot, 3, true, TYPES), /!\[annotation 3\]\(data:image\/png/);
  assert.match(blockFor(withShot, 3, false, TYPES), /paste image for item 3/);
});

test('spacing edit names the token, the provenance selector, and the smallest-edit directive', () => {
  const edit = {
    property: 'padding',
    before: '20px',
    after: { token: '--spacing-xl', value: '24px', offScale: false },
    provenance: { selector: '.card[data-v-1a2b]', sourceKind: 'scoped' },
  };
  const md = blockFor({ ...base, edits: [edit] }, 1, false, TYPES);
  assert.match(md, /\*\*Edit `padding`:\*\* `20px` → token `--spacing-xl \/ 24px`/);
  assert.match(md, /\*\*Defined at:\*\* `\.card\[data-v-1a2b\]` _\(scoped\)_/);
  assert.match(md, /\*\*Smallest edit:\*\*/);
});

test('off-scale edit renders the "needs a decision" flag', () => {
  const edit = {
    property: 'padding',
    before: '22px',
    after: { token: '--spacing-xl', value: '24px', offScale: true },
    provenance: { selector: '.card', sourceKind: 'shared' },
  };
  const md = editBlock(edit);
  assert.match(md, /No exact token:.*needs a decision/);
});

test('Spark-flagged edit renders the prop/variant directive and a no-node_modules line', () => {
  const edit = {
    property: 'background-color',
    before: 'rgb(0,0,255)',
    after: { token: '--surface-brand', value: '#0a64ff', offScale: false },
    provenance: { selector: '.spark-button', sourceKind: 'spark' },
    role: 'surface-brand',
  };
  const md = editBlock(edit);
  assert.match(md, /\*\*Semantic role:\*\* `surface-brand`/);
  assert.match(md, /use a prop\/variant change at the usage site/);
  assert.match(md, /Do not edit node_modules/);
  assert.doesNotMatch(md, /Smallest edit/); // spark gets the prop directive instead
});

test('color edit names the current role and directs a role swap, not a primitive write', () => {
  const edit = {
    kind: 'color',
    property: 'background-color',
    before: 'var(--surface-brand-default)',
    after: { token: '--color-blue-600', value: '#0850cc', offScale: false },
    provenance: { selector: '.card[data-v-1a2b]', sourceKind: 'scoped' },
    role: '--surface-brand-default',
  };
  const md = editBlock(edit);
  assert.match(md, /\*\*Semantic role:\*\* `--surface-brand-default` currently applies/);
  assert.match(md, /Swap the role, not the primitive/);
  assert.match(md, /switching to the semantic token whose value matches/);
  assert.doesNotMatch(md, /Smallest edit/); // color never gets the raw-source directive
});

test('color edit with no semantic role renders the design-system flag', () => {
  const edit = {
    kind: 'color',
    property: 'color',
    before: '#111111',
    after: { token: '--color-blue-500', value: '#0a64ff', offScale: false },
    provenance: { selector: '.label', sourceKind: 'scoped' },
    role: null,
  };
  const md = editBlock(edit);
  assert.match(md, /No semantic role applies/);
  assert.match(md, /flag for design-system review/);
  assert.doesNotMatch(md, /Smallest edit/);
});

test('copy edit renders the before→after wording and the i18n-aware directive', () => {
  const edit = { type: 'copy', before: 'Save', after: 'Apply changes' };
  const md = editBlock(edit);
  assert.match(md, /\*\*Edit copy:\*\* "Save" → "Apply changes"/);
  assert.match(md, /Update the rendered string at its source/);
  assert.match(md, /i18n-bound, edit the message catalog/);
  assert.doesNotMatch(md, /Smallest edit/); // copy never gets the token/source directive
});

test('buildHandoff joins header + numbered blocks via numberOf', () => {
  const items = [base, { ...base, comment: 'second' }];
  const md = buildHandoff(items, (a) => items.indexOf(a) + 5, false, TYPES);
  assert.ok(md.startsWith(HANDOFF_HEADER));
  assert.match(md, /### 5\. /);
  assert.match(md, /### 6\. /);
});

// ---- Context chips (0011) — read-only element references for a chat turn ----

const chipBase = {
  label: 'button.primary',
  tag: 'button',
  loc: 'app/Card.vue:12:5',
  classList: ['primary', 'lg'],
  provenance: { selector: '.primary', sourceKind: 'shared', value: '#0a64ff' },
  screenshot: null,
};

test('chipBlock renders label, source, element + classes and style source', () => {
  const md = chipBlock(chipBase, 1);
  assert.match(md, /### 1\. button\.primary/);
  assert.match(md, /\*\*Source:\*\* `app\/Card\.vue:12:5`/);
  assert.match(md, /\*\*Element:\*\* `<button>`/);
  assert.match(md, /classes: `primary lg`/);
  assert.match(md, /\*\*Style source:\*\* `\.primary` _\(shared\)_/);
});

test('chipBlock notes an attached screenshot by image number', () => {
  const md = chipBlock({ ...chipBase, screenshot: 'data:image/png;base64,AAA' }, 4);
  assert.match(md, /\*\*Screenshot:\*\* _\(attached — image 4\)_/);
});

test('chipBlock with no screenshot omits the screenshot line', () => {
  assert.doesNotMatch(chipBlock(chipBase, 1), /Screenshot/);
});

test('chipBlock flags a Spark-owned element with the no-node_modules directive', () => {
  const md = chipBlock(
    { ...chipBase, provenance: { selector: '.spark-btn', sourceKind: 'spark', value: '#fff' } },
    1,
  );
  assert.match(md, /Spark-owned/);
  assert.match(md, /do not edit node_modules/);
});

test('chipBlock with unknown loc and no provenance stays terse', () => {
  const md = chipBlock({ label: 'div', tag: 'div', loc: '', classList: [], provenance: null }, 1);
  assert.match(md, /\*\*Source:\*\* `unknown`/);
  assert.doesNotMatch(md, /Style source/);
});

test('contextChipsBlock joins the header + numbered chip blocks', () => {
  const md = contextChipsBlock([chipBase, { ...chipBase, label: 'div.card' }]);
  assert.ok(md.startsWith(CONTEXT_HEADER));
  assert.match(md, /### 1\. button\.primary/);
  assert.match(md, /### 2\. div\.card/);
});
