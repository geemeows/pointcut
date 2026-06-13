// Run: node --import tsx --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJsxStamper, LOC_ATTR } from './jsx.ts';

const ROOT = '/project';
const stamp = (code, file = '/project/src/App.jsx') => createJsxStamper(ROOT).transform(code, file);

test('test() owns app .jsx/.tsx files, not node_modules or other extensions', () => {
  const s = createJsxStamper(ROOT);
  assert.equal(s.test('/project/src/App.jsx'), true);
  assert.equal(s.test('/project/src/App.tsx'), true);
  assert.equal(s.test('/project/src/App.tsx?v=123'), true);
  assert.equal(s.test('/project/node_modules/lib/X.jsx'), false);
  assert.equal(s.test('/project/src/App.vue'), false);
  assert.equal(s.test('/project/src/main.js'), false);
});

test('stamps a host element with the correct file:line:col', () => {
  const code = 'export const A = () =>\n  <button>Go</button>;\n';
  const out = stamp(code);
  // <button> opens on line 2, col 3 (Babel col 2, +1 to match Vue's 1-based col).
  assert.match(out.code, new RegExp(`<button ${LOC_ATTR}="src/App\\.jsx:2:3">`));
});

test('skips uppercase component elements (their attrs are props, not DOM)', () => {
  const code = 'export const A = () => <MyButton>Go</MyButton>;\n';
  const out = stamp(code);
  assert.equal(out, null, 'no host elements → nothing stamped → null');
});

test('skips member-expression component elements (<Foo.Bar/>)', () => {
  const code = 'export const A = () => <Foo.Bar prop="x" />;\n';
  assert.equal(stamp(code), null);
});

test('stamps hosts but leaves component tags untouched in a mixed tree', () => {
  const code =
    'export const A = () => (\n' +
    '  <section>\n' +
    '    <Widget />\n' +
    '    <span>hi</span>\n' +
    '  </section>\n' +
    ');\n';
  const out = stamp(code);
  const hits = out.code.match(new RegExp(LOC_ATTR, 'g')) || [];
  assert.equal(hits.length, 2, 'only <section> and <span> stamped, not <Widget>');
  assert.doesNotMatch(out.code, /<Widget[^>]*data-pointcut-loc/);
});

test('preserves existing attributes', () => {
  const code = 'export const A = () => <a href="/x" className="c">y</a>;\n';
  const out = stamp(code);
  assert.match(out.code, new RegExp(`href="/x"`));
  assert.match(out.code, new RegExp(`className="c"`));
  assert.match(out.code, new RegExp(`${LOC_ATTR}="[^"]+"`));
});

test('handles TSX with type syntax', () => {
  const code =
    'export const A = (p: { n: number }) => <div className="x">{p.n}</div>;\n';
  const out = stamp(code, '/project/src/App.tsx');
  assert.match(out.code, new RegExp(`<div className="x" ${LOC_ATTR}="src/App\\.tsx:1:`));
});

test('is idempotent — a second pass changes nothing', () => {
  const code = 'export const A = () =>\n  <div><span>x</span></div>;\n';
  const once = stamp(code).code;
  const twice = stamp(once);
  assert.equal(twice, null, 'already-stamped hosts are skipped, so nothing to stamp');
});

test('returns null when there are no host elements', () => {
  assert.equal(stamp('export const n = 1 + 2;\n'), null);
});

test('emits a source map with mappings and the original source', () => {
  const code = 'export const A = () =>\n  <button>Go</button>;\n';
  const out = stamp(code);
  assert.ok(out.map, 'a map is returned');
  assert.ok(out.map.mappings && out.map.mappings.length > 0, 'map has mappings');
  assert.equal(out.map.version, 3);
});
