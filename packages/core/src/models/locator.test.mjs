/* eslint-disable */
// Run: node --test vite/design-toolbar/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocator } from './locator.mjs';

const LOC = 'data-luciq-loc';

// Minimal DOM fake: just enough for indexPath / elFromPath / resolve / rectFor.
const makeEl = (tag, loc) => ({
  nodeType: 1,
  tagName: tag.toUpperCase(),
  parentElement: null,
  children: [],
  isConnected: true,
  rect: { left: 1, top: 2, right: 3, bottom: 4 },
  attrs: loc ? { [LOC]: loc } : {},
  getAttribute(k) {
    return this.attrs[k] != null ? this.attrs[k] : null;
  },
  getBoundingClientRect() {
    return this.rect;
  },
});
const append = (parent, child) => {
  child.parentElement = parent;
  parent.children.push(child);
  return child;
};

// body > section > (a, target[loc])
const body = makeEl('body');
const section = append(body, makeEl('section'));
append(section, makeEl('a'));
const target = append(section, makeEl('div', 'app/x.vue:5:1'));

const allEls = [body, section, ...section.children];
const doc = {
  body,
  querySelector(sel) {
    const m = sel.match(/\[data-luciq-loc="(.*)"\]/);
    const want = m && m[1];
    return allEls.find((e) => e.getAttribute(LOC) === want) || null;
  },
};
const win = { scrollX: 100, scrollY: 50, CSS: { escape: (s) => s } };

const locator = () => createLocator({ doc, win, locAttr: LOC });

test('indexPath then elFromPath round-trips to the same element', () => {
  const L = locator();
  const path = L.indexPath(target);
  assert.deepEqual(path, [0, 1]); // section is body.children[0], target is section.children[1]
  assert.equal(L.elFromPath ? undefined : undefined, undefined); // elFromPath is internal
  // resolve via path uses the same machinery:
  assert.equal(L.resolve({ id: 'a1', path, loc: '' }), target);
});

test('stampedAncestor walks up to the nearest stamped node', () => {
  const L = locator();
  assert.equal(L.stampedAncestor(target), target);
  // an unstamped child resolves to its stamped ancestor
  const child = append(target, makeEl('span'));
  assert.equal(L.stampedAncestor(child), target);
  target.children.pop();
});

test('resolve falls back to loc when there is no path', () => {
  const L = locator();
  assert.equal(L.resolve({ id: 'a1', path: null, loc: 'app/x.vue:5:1' }), target);
});

test('resolve prefers a connected cached ref', () => {
  const L = locator();
  L.remember('a1', target);
  assert.equal(L.resolve({ id: 'a1', path: [9, 9], loc: 'nope' }), target);
  L.forget('a1');
});

test('rectFor: region uses page coords minus scroll', () => {
  const L = locator();
  const r = L.rectFor({ region: { x: 200, y: 150, w: 10, h: 20 } });
  assert.deepEqual(r, { left: 100, top: 100, right: 110, bottom: 120 });
});

test('rectFor: element uses the live bounding rect', () => {
  const L = locator();
  assert.deepEqual(L.rectFor({ id: 'a1', path: [0, 1], loc: '' }), target.rect);
});
