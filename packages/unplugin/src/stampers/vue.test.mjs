// Run: node --import tsx --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVueStamper, LOC_ATTR } from './vue.ts';

const ROOT = '/project';
const stamp = (code, file = '/project/src/App.vue') => createVueStamper(ROOT).transform(code, file);

test('test() owns app .vue files, not node_modules or other extensions', () => {
  const s = createVueStamper(ROOT);
  assert.equal(s.test('/project/src/App.vue'), true);
  assert.equal(s.test('/project/src/App.vue?vue&type=template'), true);
  assert.equal(s.test('/project/node_modules/lib/X.vue'), false);
  assert.equal(s.test('/project/src/main.js'), false);
});

test('stamps an opening tag with the correct file:line:col', () => {
  const code = '<template>\n  <button>Go</button>\n</template>\n';
  const out = stamp(code);
  // The <button> sits on line 2, col 3 (1-based col after the leading newline).
  assert.match(out.code, new RegExp(`<button ${LOC_ATTR}="src/App\\.vue:2:3">`));
});

test('stamps every opening tag and leaves closing tags alone', () => {
  const code = '<template>\n  <div><span>x</span></div>\n</template>\n';
  const out = stamp(code);
  const opens = out.code.match(new RegExp(LOC_ATTR, 'g')) || [];
  assert.equal(opens.length, 2); // <div> and <span>, not </span>/</div>
});

test('preserves existing attributes', () => {
  const code = '<template>\n  <a href="/x" class="c">y</a>\n</template>\n';
  const out = stamp(code);
  assert.match(out.code, new RegExp(`<a href="/x" class="c" ${LOC_ATTR}="[^"]+">`));
});

test('stamps self-closing tags before the slash', () => {
  const code = '<template>\n  <img src="a.png"/>\n</template>\n';
  const out = stamp(code);
  assert.match(out.code, new RegExp(`<img src="a\\.png" ${LOC_ATTR}="[^"]+"/>`));
});

test('skips the SFC <template> wrapper itself', () => {
  const code = '<template>\n  <div>x</div>\n</template>\n';
  const out = stamp(code);
  assert.doesNotMatch(out.code, new RegExp(`<template ${LOC_ATTR}`));
});

test('is idempotent — a second pass changes nothing', () => {
  const code = '<template>\n  <div><span>x</span></div>\n</template>\n';
  const once = stamp(code).code;
  const twice = stamp(once);
  assert.equal(twice, null, 'already-stamped tags are skipped, so nothing to stamp');
});

test('returns null when there is no <template> block', () => {
  assert.equal(stamp('<script>export default {}</script>\n'), null);
});

test('returns null when the template has no stampable tags', () => {
  assert.equal(stamp('<template>\n  just text\n</template>\n'), null);
});

test('emits a source map with mappings and the original source', () => {
  const code = '<template>\n  <button>Go</button>\n</template>\n';
  const out = stamp(code);
  assert.ok(out.map, 'a map is returned');
  assert.ok(out.map.mappings && out.map.mappings.length > 0, 'map has mappings');
  assert.equal(out.map.version, 3);
  assert.deepEqual(out.map.sourcesContent, [code]);
});
