// Run: node --import tsx --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSvelteStamper, LOC_ATTR } from './svelte.ts';

const ROOT = '/project';
const stamp = (code, file = '/project/src/App.svelte') =>
  createSvelteStamper(ROOT).transform(code, file);

test('test() owns app .svelte files, not node_modules or other extensions', () => {
  const s = createSvelteStamper(ROOT);
  assert.equal(s.test('/project/src/App.svelte'), true);
  assert.equal(s.test('/project/src/App.svelte?svelte&type=style'), true);
  assert.equal(s.test('/project/node_modules/lib/X.svelte'), false);
  assert.equal(s.test('/project/src/main.js'), false);
});

test('stamps an opening tag with the correct file:line:col', () => {
  const code = '<button>Go</button>\n';
  const out = stamp(code);
  // <button> sits on line 1, col 1.
  assert.match(out.code, new RegExp(`<button ${LOC_ATTR}="src/App\\.svelte:1:1">`));
});

test('computes line:col across leading script/markup', () => {
  const code = '<script>\n  let n = 1;\n</script>\n\n<button>Go</button>\n';
  const out = stamp(code);
  // <button> is on line 5, col 1.
  assert.match(out.code, new RegExp(`<button ${LOC_ATTR}="src/App\\.svelte:5:1">`));
});

test('stamps every opening tag and leaves closing tags alone', () => {
  const code = '<div><span>x</span></div>\n';
  const out = stamp(code);
  const opens = out.code.match(new RegExp(LOC_ATTR, 'g')) || [];
  assert.equal(opens.length, 2); // <div> and <span>, not </span>/</div>
});

test('preserves existing attributes', () => {
  const code = '<a href="/x" class="c">y</a>\n';
  const out = stamp(code);
  assert.match(out.code, new RegExp(`<a href="/x" class="c" ${LOC_ATTR}="[^"]+">`));
});

test('stamps self-closing tags before the slash', () => {
  const code = '<img src="a.png"/>\n';
  const out = stamp(code);
  assert.match(out.code, new RegExp(`<img src="a\\.png" ${LOC_ATTR}="[^"]+"/>`));
});

test('does NOT stamp inside <script> or <style> blocks', () => {
  const code =
    '<script>\n  const html = "<b>not markup</b>";\n</script>\n' +
    '<div>x</div>\n' +
    '<style>\n  div { color: red; }\n</style>\n';
  const out = stamp(code);
  const opens = out.code.match(new RegExp(LOC_ATTR, 'g')) || [];
  assert.equal(opens.length, 1, 'only the real <div> in markup is stamped');
  // The string-literal <b> inside <script> is untouched.
  assert.match(out.code, /const html = "<b>not markup<\/b>";/);
});

test('skips <svelte:*> special elements but stamps real markup around them', () => {
  const code = '<svelte:head>\n  <title>Hi</title>\n</svelte:head>\n<div>x</div>\n';
  const out = stamp(code);
  assert.doesNotMatch(out.code, new RegExp(`<svelte:head ${LOC_ATTR}`));
  // <title> and <div> are real DOM and get stamped.
  assert.match(out.code, new RegExp(`<title ${LOC_ATTR}="[^"]+">`));
  assert.match(out.code, new RegExp(`<div ${LOC_ATTR}="[^"]+">`));
});

test('stamps component usages (capitalized) at the usage site', () => {
  const code = '<MyButton primary>Go</MyButton>\n';
  const out = stamp(code);
  assert.match(out.code, new RegExp(`<MyButton primary ${LOC_ATTR}="[^"]+">`));
});

test('does not stamp Svelte logic blocks ({#if}/{#each})', () => {
  const code = '{#each items as item}\n  <li>{item}</li>\n{/each}\n';
  const out = stamp(code);
  const opens = out.code.match(new RegExp(LOC_ATTR, 'g')) || [];
  assert.equal(opens.length, 1, 'only the <li> tag is stamped');
  assert.match(out.code, /\{#each items as item\}/);
});

test('is idempotent — a second pass changes nothing', () => {
  const code = '<div><span>x</span></div>\n';
  const once = stamp(code).code;
  const twice = stamp(once);
  assert.equal(twice, null, 'already-stamped tags are skipped, so nothing to stamp');
});

test('returns null when there are no stampable tags', () => {
  assert.equal(stamp('<script>export const x = 1;</script>\n'), null);
  assert.equal(stamp('just text\n'), null);
});

test('emits a source map with mappings and the original source', () => {
  const code = '<button>Go</button>\n';
  const out = stamp(code);
  assert.ok(out.map, 'a map is returned');
  assert.ok(out.map.mappings && out.map.mappings.length > 0, 'map has mappings');
  assert.equal(out.map.version, 3);
  assert.deepEqual(out.map.sourcesContent, [code]);
});
